/**
 * SC Pigtail — single SC connector (End A) + bare/stripped fiber tail (End B).
 * Connector plugs into OLT / splitter / coupler ports; bare tip parks on
 * splice / termination points (.lab-splice-point, [data-lab-splice], …).
 */
(function (global) {
  'use strict';

  global.isSleeveShrunk = false;
  if (typeof window !== 'undefined') window.isSleeveShrunk = false;

  var MISMATCH_MSG =
    'Connector polish mismatch (SC/APC ↔ SC/PC): high back reflection expected. ' +
    'Connection allowed — extra insertion loss applied to the power budget.';
  var MISMATCH_PENALTY_DB = 3.0;
  var MATCHED_CONNECTOR_DB = 0.2;

  var END_W = 14;
  var END_H = 22;
  /*
   * Same local frame as patch cord (lab-pcord__end):
   *   ferrule = local −Y (nose), ribbed boot = local +Y (cable exit).
   * World pos = button center; path must start at bootAnchor (rear tip).
   */
  var BOOT_EXIT_OFFSET = END_H / 2;
  var BOOT_EXIT_STUB = 10;
  var STRAIN_RELIEF_PX = 22;
  var UNPLUG_PULL_PX = 22;
  var PLUG_SNAP_PX = 22;
  var OLS_MAGNET_SNAP_PX = 56;
  var OLS_MAGNET_LOCK_PX = 30;
  var OPM_MAGNET_SNAP_PX = 52;
  var OTDR_MAGNET_SNAP_PX = 68;
  var OTDR_PLUG_SNAP_PX = 50;
  var TAIL_SNAP_PX = 18;
  var TAIL_W = 10;
  var TAIL_H = 16;
  var HEADING_MIN_PX = 2.5;
  var HEADING_SMOOTH = 0.42;
  var HISTORY_MAX = 60;
  var PIGTAIL_CATENARY_SAMPLES = 48;
  var PIGTAIL_CATENARY_SLACK = 1.12;
  var SLEEVE_MOUNT_PROX_PX = 25;
  /** Short jacket stub (world px) at a fused cable tip — mirrors buildCableEndStripSvg splice zone. */
  var CABLE_FUSION_JACKET_STUB_PX = 25;
  var SLEEVE_EJECT_PULL_PX = 14;
  var STRIP_CLAMP_PROX_PX = 6;
  /** Hard max distance from cutting notch to fiber centerline for clamp/strip. */
  var STRIP_NOTCH_HIT_PX = 6;
  /** Ephemeral peel animation scale (px dragged per full peel = 1). */
  var STRIP_PEEL_ANIM_PX = 18;
  /** Bare tip zone for cleaver V-groove alignment. */
  var CLEAVE_TIP_ZONE_PX = 52;
  var CLEAVE_HIT_PX = 8;
  /** Cleaved bare-glass protrusion (world px) — admin override via FtthLabSettings. */
  var DEFAULT_CLEAVED_GLASS_LENGTH_PX = 16;
  var CLEAVE_WASTE_PX = DEFAULT_CLEAVED_GLASS_LENGTH_PX;
  var CLEAVE_MIN_CUT_PX = 2;
  var BLADE_HIT_RADIUS_PX = 20;
  /** Dropzone highlight radius (fiber tip → cleaver groove). Snap occurs on release only. */
  var CLEAVER_SNAP_PX = 40;
  /** Pointer → silver `.clamp-base-groove` center (world px); live pull + lock on release. */
  var SPLICER_SNAP_PX = 40;
  var SPLICER_UNDOCK_PX = 22;
  /** Jacket frontier must not cross ruler stop beyond this tolerance (world px). */
  var RULER_WALL_EPS = 0.75;
  /** Orthogonal snake: adaptive primary-axis preview + fillet corners. */
  var ORTHO_FILLET_R = 16;
  var ORTHO_TURN_PX = 10;
  var ORTHO_MIN_SEG = 8;
  var ORTHO_BACKTRACK_PX = 8;
  /** Initial free length: connector (left) → bare tip (right), same Y. */
  var SPAWN_LEN_PX = 120;
  /** Lab-world SVG stroke widths — keep in sync with .lab-pigtail-fiber--* in ftth-lab.css */
  var PIGTAIL_FIBER_STROKE_JACKET_PX = 2.15;
  var PIGTAIL_FIBER_STROKE_BUFFER_PX = 1.65;
  var PIGTAIL_FIBER_STROKE_BARE_PX = 1.15;
  /** 250µm buffer/coating (fiber #1 blue) — sync with .lab-pigtail-fiber--buffer in ftth-lab.css */
  var PIGTAIL_BUFFER_STROKE_COLOR = '#7FB5F5';

  /** TIA-598 12-color sequence — sync with fiber-3d-simulator.js COLOR / COLOR_ORDER_12 */
  var FIBER_COLORS = {
    Blue: '#2563eb',
    Orange: '#f97316',
    Green: '#16a34a',
    Brown: '#854d0e',
    Slate: '#64748b',
    White: '#ffffff',
    Red: '#dc2626',
    Black: '#000000',
    Yellow: '#facc15',
    Violet: '#7c3aed',
    Rose: '#f43f5e',
    Aqua: '#06b6d4',
  };
  var FIBER_COLOR_ORDER = [
    'Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White',
    'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua',
  ];

  function normalizeJacketColorName(name) {
    if (!name) return 'Yellow';
    var key = String(name);
    if (FIBER_COLORS[key]) return key;
    var lower = key.toLowerCase();
    for (var ci = 0; ci < FIBER_COLOR_ORDER.length; ci++) {
      if (FIBER_COLOR_ORDER[ci].toLowerCase() === lower) return FIBER_COLOR_ORDER[ci];
    }
    return 'Yellow';
  }

  function getJacketColorName(p) {
    return normalizeJacketColorName(p && p.jacketColor);
  }

  function getJacketColorHex(p) {
    return FIBER_COLORS[getJacketColorName(p)] || FIBER_COLORS.Yellow;
  }

  function jacketStrokeStyleAttr(p) {
    return ' style="stroke:' + getJacketColorHex(p) + '"';
  }

  function jacketPathStyleAttr(p, layerName, peel, peelLayer) {
    var parts = ['stroke:' + getJacketColorHex(p)];
    if (peel > 0.02 && peelLayer === layerName) {
      parts.push('--strip-peel:' + peel.toFixed(3));
    }
    return ' style="' + parts.join(';') + '"';
  }

  function buildJacketColorPaletteHtml(p) {
    var active = getJacketColorName(p);
    var html =
      '<p class="lab-inspector__label">Jacket Color</p>' +
      '<div class="lab-jacket-color-palette" role="group" aria-label="Jacket color">';
    FIBER_COLOR_ORDER.forEach(function (name) {
      var hex = FIBER_COLORS[name];
      var isActive = name === active;
      html +=
        '<button type="button" class="lab-jacket-color-swatch' + (isActive ? ' is-active' : '') +
        '" data-jacket-color="' + name + '" title="' + name + '" aria-label="' + name +
        '" aria-pressed="' + (isActive ? 'true' : 'false') +
        '" style="--swatch-color:' + hex + '"><span aria-hidden="true"></span></button>';
    });
    html += '</div>';
    return html;
  }

  function isCable(p) {
    return !!(p && p.type === 'cable');
  }

  function cableEndFromToken(token) {
    if (token === 'start' || token === 'A') return 'start';
    return 'end';
  }

  function parseFiberTargetId(targetId) {
    var raw = String(targetId || '');
    var parts = raw.split(':');
    var id = parts[0];
    var end = parts.length > 1 ? cableEndFromToken(parts[1]) : 'end';
    var p = findPigtail(id);
    if (!p) return null;
    if (!isCable(p)) end = 'end';
    return { p: p, id: p.id, end: end, targetId: end === 'end' ? p.id : p.id + ':start' };
  }

  function fiberTargetId(p, end) {
    if (!isCable(p)) return p.id;
    return cableEndFromToken(end) === 'start' ? p.id + ':start' : p.id;
  }

  function ensureEndPrepStateFields(prep) {
    if (!prep || typeof prep !== 'object') {
      return {
        stripped: false,
        cleaned: false,
        cleaved: false,
        coatingRemoved: false,
        strippedLengthPx: 0,
        hasSleeve: false,
        sleeveAlong: null,
      };
    }
    if (typeof prep.hasSleeve !== 'boolean') prep.hasSleeve = false;
    if (prep.sleeveAlong != null && typeof prep.sleeveAlong !== 'number') prep.sleeveAlong = null;
    if (typeof prep.strippedLengthPx !== 'number' || !isFinite(prep.strippedLengthPx)) {
      prep.strippedLengthPx = 0;
    }
    if (prep.strippedLengthPx < 0) prep.strippedLengthPx = 0;
    if (typeof prep.coatingRemoved !== 'boolean') prep.coatingRemoved = false;
    return prep;
  }

  function ensurePigtailPrepState(p) {
    if (!p || isCable(p)) return null;
    if (!p.prepState || typeof p.prepState !== 'object') {
      p.prepState = {
        stripped: false,
        cleaned: false,
        cleaved: false,
        coatingRemoved: false,
        strippedLengthPx: 0,
      };
    }
    ensureEndPrepStateFields(p.prepState);
    if (!p.prepState.strippedLengthPx && Number(p.stripLengthPx) > 0) {
      p.prepState.strippedLengthPx = Number(p.stripLengthPx) || 0;
    }
    p.prepState.stripped = !!(p.isStripped || (Number(p.stripStage) || 0) >= 1);
    p.prepState.cleaned = !!p.isCleaned;
    p.prepState.cleaved = !!(p.isCleaved || p.cleaved);
    p.prepState.coatingRemoved = (Number(p.stripStage) || 0) >= 2 ||
      isBareStripComplete(ensureFiberStrip(p));
    p.prepState.hasSleeve = !!p.hasSleeve;
    if (p.hasSleeve && typeof p.sleeveAlong === 'number') {
      p.prepState.sleeveAlong = p.sleeveAlong;
    } else if (!p.hasSleeve) {
      p.prepState.sleeveAlong = null;
    }
    return p.prepState;
  }

  function getEndPrepState(p, end) {
    if (!p) return null;
    if (isCable(p)) {
      syncCablePrepState(p);
      end = cableEndFromToken(end);
      return end === 'start' ? p.startPrepState : p.endPrepState;
    }
    return ensurePigtailPrepState(p);
  }

  function getEndStrippedLengthPx(p, end) {
    var prep = getEndPrepState(p, end);
    return prep ? Math.max(0, Number(prep.strippedLengthPx) || 0) : 0;
  }

  function stripDepthFromToolWorld(p, end, wx, wy) {
    end = resolveCableEnd(p, end);
    var pts = cableStripPathPoints(p, end);
    var depth = 0;
    if (pts && pts.length >= 2) {
      var proj = projectOntoFiberStrict(pts, wx, wy);
      if (proj) depth = Math.max(0, proj.dist || 0);
    }
    if (depth < STRIP_TIP_EPS) {
      depth = cableEndTipDist(p, end, wx, wy);
    }
    return depth;
  }

  function resetEndCleanCleaveFlags(p, end) {
    end = resolveCableEnd(p, end);
    if (isCable(p)) {
      if (end === 'start') {
        p.startIsCleaned = false;
        p.startIsCleaved = false;
        p.startCleaved = false;
        p.startCleavedStripLock = null;
      } else {
        p.isCleaned = false;
        p.isCleaved = false;
        p.cleaved = false;
        p.cleavedStripLock = null;
      }
      return;
    }
    p.isCleaned = false;
    p.isCleaved = false;
    p.cleaved = false;
    p.cleavedStripLock = null;
    p.stripFrontierLock = null;
  }

  /**
   * Jacket strip extended past prior frontier — restore buffer coating on the new span,
   * invalidate clean/cleave, and drop back to jacket-only stage.
   */
  function resetPrepOnStripExtension(p, end, prevLen) {
    var prep = getEndPrepState(p, end);
    if (!prep) return;
    var fs = ensureCableEndStrip(p, end);
    var stage = isCable(p) ? getCableEndStripStage(p, end) : (Number(p.stripStage) || 0);
    var coatingWasRemoved = stage >= 2 || isBareStripComplete(fs) || !!prep.coatingRemoved;

    prep.cleaned = false;
    prep.cleaved = false;
    prep.coatingRemoved = false;
    resetEndCleanCleaveFlags(p, end);

    if (coatingWasRemoved) {
      fs.bareTo = Math.max(0, prevLen);
    } else if ((fs.bareTo || 0) > STRIP_TIP_EPS) {
      fs.bareTo = Math.min(fs.bareTo || 0, prevLen);
    } else {
      fs.bareTo = 0;
    }

    if (isCable(p)) {
      setCableEndStripStage(p, end, (fs.jacketTo || 0) > STRIP_TIP_EPS || prevLen > STRIP_TIP_EPS ? 1 : 0);
    } else {
      p.stripStage = (fs.jacketTo || 0) > STRIP_TIP_EPS || prevLen > STRIP_TIP_EPS ? 1 : 0;
      p.stripFrontierLock = null;
    }
  }

  function syncFiberStripFromStrippedLength(p, end) {
    if (!p) return;
    end = resolveCableEnd(p, end);
    var len = getEndStrippedLengthPx(p, end);
    var fs = ensureCableEndStrip(p, end);
    var stage = isCable(p) ? getCableEndStripStage(p, end) : (Number(p.stripStage) || 0);
    if (len <= STRIP_TIP_EPS) return;
    if (stage >= 2 && isBareStripComplete(fs)) {
      fs.jacketTo = len;
      fs.bareTo = len;
    } else if (stage >= 1) {
      fs.jacketTo = Math.max(fs.jacketTo || 0, len);
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    } else {
      fs.jacketTo = Math.max(fs.jacketTo || 0, len);
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    }
    if (isCable(p)) {
      if (end === 'start') p.startStripLengthPx = len;
      else p.stripLengthPx = len;
    } else {
      p.stripLengthPx = len;
    }
  }

  function applyStrippedLengthPx(p, end, distPx, opts) {
    opts = opts || {};
    if (!p) return 0;
    end = resolveCableEnd(p, end);
    var prep = getEndPrepState(p, end);
    if (!prep) return 0;
    var maxLen = maxCableEndStripLenPx(p, end);
    var n = Number(distPx);
    if (!isFinite(n) || n < 0) n = 0;
    var prevLen = prep.strippedLengthPx || 0;
    var isBufferPeel = !!(opts.bufferPeel || opts.layer === 'buffer');
    if (n > prevLen + STRIP_TIP_EPS && !isBufferPeel) {
      resetPrepOnStripExtension(p, end, prevLen);
    }
    n = Math.min(maxLen, Math.max(prevLen, n));
    prep.strippedLengthPx = n;
    prep.stripped = n > STRIP_TIP_EPS;
    if (isCable(p)) {
      if (end === 'start') {
        p.startIsStripped = prep.stripped;
        p.startStripLengthPx = n;
      } else {
        p.isStripped = prep.stripped;
        p.stripLengthPx = n;
      }
    } else {
      p.isStripped = prep.stripped;
      p.stripLengthPx = n;
    }
    syncFiberStripFromStrippedLength(p, end);
    if (isBufferPeel && (isCable(p) ? getCableEndStripStage(p, end) >= 2 : (Number(p.stripStage) || 0) >= 2)) {
      prep.coatingRemoved = true;
    }
    return n;
  }

  function recordStripToolAtWorld(id, wx, wy, opts) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p) return 0;
    var end = target.end || 'end';
    opts = opts || {};
    return applyStrippedLengthPx(
      p,
      end,
      stripDepthFromToolWorld(p, end, wx, wy),
      opts
    );
  }

  function syncCablePrepState(p) {
    if (!isCable(p)) return;
    if (!p.startPrepState || typeof p.startPrepState !== 'object') {
      p.startPrepState = {
        stripped: false, cleaned: false, cleaved: false, coatingRemoved: false, strippedLengthPx: 0,
      };
    }
    if (!p.endPrepState || typeof p.endPrepState !== 'object') {
      p.endPrepState = {
        stripped: false, cleaned: false, cleaved: false, coatingRemoved: false, strippedLengthPx: 0,
      };
    }
    ensureEndPrepStateFields(p.startPrepState);
    ensureEndPrepStateFields(p.endPrepState);
    if (!p.startPrepState.strippedLengthPx && Number(p.startStripLengthPx) > 0) {
      p.startPrepState.strippedLengthPx = Number(p.startStripLengthPx) || 0;
    }
    if (!p.endPrepState.strippedLengthPx && Number(p.stripLengthPx) > 0) {
      p.endPrepState.strippedLengthPx = Number(p.stripLengthPx) || 0;
    }
    var fsStart = p.startFiberStrip;
    if (fsStart && (fsStart.jacketTo || 0) > p.startPrepState.strippedLengthPx) {
      p.startPrepState.strippedLengthPx = fsStart.jacketTo;
    }
    var fsEnd = p.fiberStrip;
    if (fsEnd && (fsEnd.jacketTo || 0) > p.endPrepState.strippedLengthPx) {
      p.endPrepState.strippedLengthPx = fsEnd.jacketTo;
    }
    p.startPrepState.stripped = !!(p.startIsStripped || (Number(p.startStripStage) || 0) >= 1 ||
      p.startPrepState.strippedLengthPx > STRIP_TIP_EPS);
    p.startPrepState.cleaned = !!p.startIsCleaned;
    p.startPrepState.cleaved = !!(p.startIsCleaved || p.startCleaved);
    p.startPrepState.coatingRemoved = getCableEndStripStage(p, 'start') >= 2 ||
      isBareStripComplete(ensureCableEndStrip(p, 'start'));
    p.endPrepState.stripped = !!(p.isStripped || (Number(p.stripStage) || 0) >= 1 ||
      p.endPrepState.strippedLengthPx > STRIP_TIP_EPS);
    p.endPrepState.cleaned = !!p.isCleaned;
    p.endPrepState.cleaved = !!(p.isCleaved || p.cleaved);
    p.endPrepState.coatingRemoved = getCableEndStripStage(p, 'end') >= 2 ||
      isBareStripComplete(ensureFiberStrip(p));
    p.startPrepState.hasSleeve = !!p.startHasSleeve;
    p.endPrepState.hasSleeve = !!p.hasSleeve;
    if (p.startHasSleeve && typeof p.startSleeveAlong === 'number') {
      p.startPrepState.sleeveAlong = p.startSleeveAlong;
    } else if (!p.startHasSleeve) {
      p.startPrepState.sleeveAlong = null;
    }
    if (p.hasSleeve && typeof p.sleeveAlong === 'number') {
      p.endPrepState.sleeveAlong = p.sleeveAlong;
    } else if (!p.hasSleeve) {
      p.endPrepState.sleeveAlong = null;
    }
  }

  /** After prep-state swap, mirror swapped prep into per-end legacy fields used by rendering. */
  function applyCableLegacyFromPrepStates(p) {
    if (!isCable(p)) return;
    ensureEndPrepStateFields(p.startPrepState);
    ensureEndPrepStateFields(p.endPrepState);
    p.startIsStripped = !!p.startPrepState.stripped;
    p.isStripped = !!p.endPrepState.stripped;
    p.startIsCleaned = !!p.startPrepState.cleaned;
    p.isCleaned = !!p.endPrepState.cleaned;
    p.startIsCleaved = !!p.startPrepState.cleaved;
    p.startCleaved = !!p.startPrepState.cleaved;
    p.isCleaved = !!p.endPrepState.cleaved;
    p.cleaved = !!p.endPrepState.cleaved;
    p.startStripLengthPx = Number(p.startPrepState.strippedLengthPx) || 0;
    p.stripLengthPx = Number(p.endPrepState.strippedLengthPx) || 0;
    p.startHasSleeve = !!p.startPrepState.hasSleeve;
    p.hasSleeve = !!p.endPrepState.hasSleeve;
    p.startSleeveAlong = p.startPrepState.sleeveAlong;
    p.sleeveAlong = p.endPrepState.sleeveAlong;
  }

  /** Pigtail: bare tip only (connector blocks A). Cable: both open bare ends. */
  function sleeveMountableEnds(p) {
    if (!p) return [];
    if (!isCable(p)) return ['end'];
    return ['start', 'end'];
  }

  function canMountSleeveOnEnd(p, end) {
    if (!p) return false;
    end = cableEndFromToken(end || 'end');
    if (!isCable(p)) return end === 'end';
    return end === 'start' || end === 'end';
  }

  function sleeveSlidePathPoints(p, end) {
    if (!isCable(p)) return fiberSleevePathPoints(p);
    return cableStripPathPoints(p, cableEndFromToken(end || 'end'), true);
  }

  function pigtailEndHasSleeve(p, end) {
    if (!p) return false;
    end = cableEndFromToken(end || 'end');
    if (!isCable(p)) return end === 'end' && !!p.hasSleeve;
    if (end === 'start') return !!(p.startHasSleeve || (p.startPrepState && p.startPrepState.hasSleeve));
    return !!(p.hasSleeve || (p.endPrepState && p.endPrepState.hasSleeve));
  }

  function resolveSleeveEnd(p, end) {
    if (!isCable(p)) return 'end';
    if (end != null && end !== '') return cableEndFromToken(end);
    if (p.hasSleeve || (p.endPrepState && p.endPrepState.hasSleeve)) return 'end';
    if (p.startHasSleeve || (p.startPrepState && p.startPrepState.hasSleeve)) return 'start';
    return 'end';
  }

  function sleeveMountProximityForEnd(p, end, wx, wy, thr) {
    var tip = cableEndTipWorld(p, end);
    var tipD = dist2(wx, wy, tip.x, tip.y);
    if (tipD <= thr) return tipD;
    var pts = sleeveSlidePathPoints(p, end);
    if (!pts || pts.length < 2) return tipD;
    var proj = projectOntoFiberPath(pts, wx, wy);
    var size = getSleeveSizePx();
    var tipZone = Math.max(thr + 4, size.w * 0.85 + 16);
    if (proj.dist >= -8 && proj.dist <= tipZone && proj.perpDist <= thr) {
      return proj.perpDist;
    }
    return thr + 1;
  }

  function setCableEndSleeveState(p, end, mounted, along) {
    end = cableEndFromToken(end);
    if (end === 'start') {
      p.startHasSleeve = !!mounted;
      p.startSleeveAlong = mounted ? along : null;
      if (p.startPrepState) {
        p.startPrepState.hasSleeve = !!mounted;
        p.startPrepState.sleeveAlong = mounted ? along : null;
      }
      return;
    }
    p.hasSleeve = !!mounted;
    p.sleeveAlong = mounted ? along : null;
    if (p.endPrepState) {
      p.endPrepState.hasSleeve = !!mounted;
      p.endPrepState.sleeveAlong = mounted ? along : null;
    }
  }

  function getSleeveAlongValue(p, end) {
    var size = getSleeveSizePx();
    var sleeveEnd = resolveSleeveEnd(p, end);
    var pts = sleeveSlidePathPoints(p, sleeveEnd);
    var total = polylineLength(pts);
    var fallback = defaultSleeveAlong(total, size.w);
    if (!isCable(p)) {
      return typeof p.sleeveAlong === 'number' ? p.sleeveAlong : fallback;
    }
    if (sleeveEnd === 'start') {
      var startAlong = typeof p.startSleeveAlong === 'number'
        ? p.startSleeveAlong
        : (p.startPrepState && typeof p.startPrepState.sleeveAlong === 'number'
          ? p.startPrepState.sleeveAlong
          : null);
      return startAlong != null ? startAlong : fallback;
    }
    var endAlong = typeof p.sleeveAlong === 'number'
      ? p.sleeveAlong
      : (p.endPrepState && typeof p.endPrepState.sleeveAlong === 'number'
        ? p.endPrepState.sleeveAlong
        : null);
    return endAlong != null ? endAlong : fallback;
  }

  function setSleeveAlongValue(p, end, along) {
    if (!isCable(p)) {
      p.sleeveAlong = along;
      if (p.prepState) p.prepState.sleeveAlong = along;
      return;
    }
    if (cableEndFromToken(end) === 'start') {
      p.startSleeveAlong = along;
      if (p.startPrepState) p.startPrepState.sleeveAlong = along;
    } else {
      p.sleeveAlong = along;
      if (p.endPrepState) p.endPrepState.sleeveAlong = along;
    }
  }

  function getCableEndFiberTangentRotAtTip(p, end) {
    end = cableEndFromToken(end);
    var densePts = fiberRenderPathPointsDense(p);
    if (!densePts || densePts.length < 2) {
      var tip = cableEndTipWorld(p, end);
      var other = end === 'start' ? { x: p.bx, y: p.by } : { x: p.ax, y: p.ay };
      return fiberPathTangentRotDeg(other.x - tip.x, other.y - tip.y);
    }
    var look = Math.max(1, Math.round(densePts.length * 0.08));
    if (end === 'start') {
      var tipS = densePts[0];
      var nearS = densePts[Math.min(densePts.length - 1, look)];
      return fiberPathTangentRotDeg(nearS.x - tipS.x, nearS.y - tipS.y);
    }
    var tipE = densePts[densePts.length - 1];
    var nearE = densePts[Math.max(0, densePts.length - 1 - look)];
    return fiberPathTangentRotDeg(tipE.x - nearE.x, tipE.y - nearE.y);
  }

  function ensureCableEndStrip(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return ensureFiberStrip(p);
    if (end === 'start') {
      if (!p.startFiberStrip || typeof p.startFiberStrip !== 'object') {
        p.startFiberStrip = { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null };
      }
      return p.startFiberStrip;
    }
    return ensureFiberStrip(p);
  }

  function getCableEndStripStage(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return Number(p.stripStage) || 0;
    return end === 'start' ? (Number(p.startStripStage) || 0) : (Number(p.stripStage) || 0);
  }

  function setCableEndStripStage(p, end, stage) {
    end = cableEndFromToken(end);
    if (!isCable(p)) {
      p.stripStage = stage;
      return;
    }
    if (end === 'start') p.startStripStage = stage;
    else p.stripStage = stage;
    syncCablePrepState(p);
  }

  function isCableEndFullyStripped(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return isFullyStrippedPigtail(p);
    if (end === 'start') {
      return !!(p.startIsCleaved || p.startCleaved || (Number(p.startStripStage) || 0) >= 2);
    }
    return isFullyStrippedPigtail(p);
  }

  function isCableEndCleaved(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return !!(p.isCleaved || p.cleaved);
    return end === 'start' ? !!(p.startIsCleaved || p.startCleaved) : !!(p.isCleaved || p.cleaved);
  }

  function isCableEndCleaned(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return !!p.isCleaned;
    return end === 'start' ? !!p.startIsCleaned : !!p.isCleaned;
  }

  function cleanedBareClassForEnd(p, end) {
    return isCableEndCleaned(p, end) ? ' is-fiber-cleaned' : '';
  }

  function cableStripPathPoints(p, end, forSleeve) {
    end = cableEndFromToken(end);
    var dense = fiberRenderPathPointsDense(p);
    if (!dense || dense.length < 2) return dense;
    var pts = !isCable(p) || end === 'end' ? dense.slice().reverse() : dense.slice();
    if (!isCable(p)) return pts;
    if (forSleeve) return pts;
    /* Each end only owns arc-length from its own tip (half span) — prevents cross-end hits. */
    var total = polylineLength(pts);
    var half = total * 0.5;
    var cap = Math.min(total, half + CLEAVE_TIP_ZONE_PX);
    if (cap < total - STRIP_TIP_EPS) {
      pts = slicePolylineByDistance(pts, 0, cap);
    }
    return pts;
  }

  function maxCableEndStripLenPx(p, end) {
    var pts = cableStripPathPoints(p, end);
    var pathMax = Math.max(0, polylineLength(pts));
    return Math.max(pathMax, getBareGlassLengthAfterCutPx());
  }

  /** Render-path distance from tip — uses stored strippedLengthPx (world px, not % of span). */
  function cableEndRenderDistPx(p, end, kind) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return 0;
    var prep = cableEndPrepState(p, end);
    var len = Math.max(0, prep.strippedLengthPx || 0);
    if (isCableEndCleaved(p, end)) return getBareGlassLengthAfterCutPx();
    if (len <= STRIP_TIP_EPS) return 0;
    var fs = ensureCableEndStrip(p, end);
    var stage = getCableEndStripStage(p, end);
    if (kind === 'bare') {
      if (stage >= 2 || isBareStripComplete(fs) || prep.cleaved) return len;
      if ((fs.bareTo || 0) > STRIP_TIP_EPS) return Math.min(len, fs.bareTo || 0);
      return 0;
    }
    return len;
  }

  function endRenderStripDistPx(p, end, kind) {
    if (isCable(p)) return cableEndRenderDistPx(p, end, kind);
    var prep = ensurePigtailPrepState(p);
    var len = Math.max(0, prep.strippedLengthPx || 0);
    if (p.isCleaved || p.cleaved) return getBareGlassLengthAfterCutPx();
    if (len <= STRIP_TIP_EPS) return 0;
    var fs = ensureFiberStrip(p);
    var stage = Number(p.stripStage) || 0;
    if (kind === 'bare') {
      if (stage >= 2 || isBareStripComplete(fs)) return len;
      if ((fs.bareTo || 0) > STRIP_TIP_EPS) return Math.min(len, fs.bareTo || 0);
      return 0;
    }
    return len;
  }

  function cableEndTipWorld(p, end) {
    end = cableEndFromToken(end);
    if (end === 'start') return { x: p.ax, y: p.ay };
    return { x: p.bx, y: p.by };
  }

  /** World distance from a point to a cable end tip (start = ax/ay, end = bx/by). */
  function cableEndTipDist(p, end, wx, wy) {
    var tip = cableEndTipWorld(p, end);
    return Math.hypot(wx - tip.x, wy - tip.y);
  }

  /** Which cable end is closer to the tool — drives strip/cleave/clean hit tests. */
  function nearestCableEndAtWorld(p, wx, wy) {
    var dStart = cableEndTipDist(p, 'start', wx, wy);
    var dEnd = cableEndTipDist(p, 'end', wx, wy);
    return dStart <= dEnd ? 'start' : 'end';
  }

  /** True when (wx, wy) is unambiguously on this cable end's side of the span. */
  function cableEndOwnsToolPoint(p, end, wx, wy) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return end === 'end';
    return nearestCableEndAtWorld(p, wx, wy) === end;
  }

  function cableEndSnappedToSplicer(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return !!p.isSnappedToSplicer;
    return end === 'start' ? !!p.startIsSnappedToSplicer : !!p.isSnappedToSplicer;
  }

  function opticalEndpointKey(p, end) {
    if (!isCable(p)) return 'pigtail:' + p.id + ':tail';
    return 'cable:' + p.id + ':' + cableEndFromToken(end);
  }

  function resolveCableEnd(p, end) {
    if (!isCable(p)) return 'end';
    return cableEndFromToken(end || p.activeCableEnd || 'end');
  }

  function resolveMemberEnd(p, end) {
    if (!isCable(p)) {
      if (end == null || end === 'A' || end === 'a') return 'start';
      if (end === 'start') return 'start';
      return 'end';
    }
    return resolveCableEnd(p, end);
  }

  function otherCableEnd(end) {
    return end === 'start' ? 'end' : 'start';
  }

  /** Per-terminal fusion assembly — never bleeds across cable start/end. */
  function getMemberEndFusionAssemblyId(p, end) {
    if (!p) return null;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      var asmId = end === 'start' ? p.startFusionAssemblyId : p.fusionAssemblyId;
      if (asmId && fusedAssemblies[asmId]) return asmId;
      var partnerId = end === 'start' ? p.startFusedPartnerId : p.fusedPartnerId;
      if (partnerId) {
        var derived = makeFusionAssemblyId(p.id, partnerId);
        if (derived && fusedAssemblies[derived]) return derived;
      }
      var weldMid = end === 'start' ? p.startSplicerWeldMachineId : p.splicerWeldMachineId;
      if (weldMid && fusedAssemblies[weldMid]) {
        var legacy = fusedAssemblies[weldMid];
        if (legacy && (legacy.leftId === p.id || legacy.rightId === p.id)) return weldMid;
      }
      return null;
    }
    if (end === 'start') return null;
    if (p.fusionAssemblyId && fusedAssemblies[p.fusionAssemblyId]) return p.fusionAssemblyId;
    if (p.fusedPartnerId) {
      var pigDerived = makeFusionAssemblyId(p.id, p.fusedPartnerId);
      if (pigDerived && fusedAssemblies[pigDerived]) return pigDerived;
    }
    if (p.splicerWeldMachineId && fusedAssemblies[p.splicerWeldMachineId]) {
      var pigLegacy = fusedAssemblies[p.splicerWeldMachineId];
      if (pigLegacy && (pigLegacy.leftId === p.id || pigLegacy.rightId === p.id)) {
        return p.splicerWeldMachineId;
      }
    }
    return null;
  }

  function getMemberEndFusedPartnerId(p, end) {
    if (!p) return null;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      return end === 'start' ? (p.startFusedPartnerId || null) : (p.fusedPartnerId || null);
    }
    return p.fusedPartnerId || null;
  }

  function getMemberEndSplicerWeldMachineId(p, end) {
    if (!p) return null;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      return end === 'start' ? (p.startSplicerWeldMachineId || null) : (p.splicerWeldMachineId || null);
    }
    return p.splicerWeldMachineId || null;
  }

  function isMemberEndFused(p, end) {
    return !!getMemberEndFusionAssemblyId(p, end);
  }

  function isMemberEndFusionPermanent(p, end) {
    if (!p) return false;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      if (end === 'start' && p.startFusionPermanent) return true;
      if (end === 'end' && p.fusionPermanent) return true;
    } else if (p.isSleeveShrunk || p.fusionPermanent) {
      return true;
    }
    var asmId = getMemberEndFusionAssemblyId(p, end);
    return !!(asmId && isFusionAssemblyPermanent(fusedAssemblies[asmId]));
  }

  function isMemberEndSleeveShrunk(p, end) {
    if (!p) return false;
    end = resolveSleeveEnd(p, end);
    if (isCable(p)) {
      if (end === 'start') return !!p.startIsSleeveShrunk;
      return !!p.isSleeveShrunk;
    }
    return !!p.isSleeveShrunk;
  }

  function setMemberEndSleeveShrunk(p, end, shrunk) {
    if (!p) return;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      if (end === 'start') p.startIsSleeveShrunk = !!shrunk;
      else p.isSleeveShrunk = !!shrunk;
      return;
    }
    p.isSleeveShrunk = !!shrunk;
  }

  function setMemberEndFusionPermanent(p, end, permanent) {
    if (!p) return;
    end = resolveMemberEnd(p, end);
    if (isCable(p)) {
      if (end === 'start') p.startFusionPermanent = !!permanent;
      else p.fusionPermanent = !!permanent;
      setMemberEndSleeveShrunk(p, end, permanent);
      return;
    }
    p.isSleeveShrunk = !!permanent;
    p.fusionPermanent = !!permanent;
  }

  function getFusedPartnerForEnd(p, end) {
    if (!p) return null;
    var partnerId = getMemberEndFusedPartnerId(p, end);
    if (partnerId) {
      var byId = findPigtail(partnerId);
      if (byId) return byId;
    }
    var asmId = getMemberEndFusionAssemblyId(p, end);
    if (!asmId) return null;
    var pair = getFusedAssemblyPigtails(asmId);
    if (!pair.left || !pair.right) return null;
    return pair.left.id === p.id ? pair.right : pair.left;
  }

  function cableEndPrepState(p, end) {
    syncCablePrepState(p);
    end = cableEndFromToken(end);
    return end === 'start' ? p.startPrepState : p.endPrepState;
  }

  function cableEndIsSnappedToCleaver(p, end) {
    end = cableEndFromToken(end);
    if (!isCable(p)) return !!p.isSnappedToCleaver;
    return end === 'start' ? !!p.startIsSnappedToCleaver : !!p.isSnappedToCleaver;
  }

  function cableEndIsSnappedToSplicer(p, end) {
    return cableEndSnappedToSplicer(p, end);
  }

  function getBareGlassDrawLengthPxForEnd(p, end) {
    if (!p) return 0;
    end = resolveCableEnd(p, end);
    if (isCable(p)) return cableEndRenderDistPx(p, end, 'bare');
    var fs = ensureCableEndStrip(p, end);
    var jacketTo = Math.max(0, fs.jacketTo || 0);
    var bareTo = Math.max(0, fs.bareTo || 0);
    if (isCableEndFullyStripped(p, end) || isBareStripComplete(fs)) bareTo = jacketTo;
    if (bareTo <= STRIP_TIP_EPS) return 0;
    return stripArcOnRenderPath(p, bareTo);
  }

  function getSplicerExposedBareLengthPxForEnd(p, end) {
    end = resolveCableEnd(p, end);
    if (isCableEndCleaved(p, end)) return getBareGlassLengthAfterCutPx();
    return Math.max(CLEAVE_MIN_CUT_PX, getBareGlassDrawLengthPxForEnd(p, end));
  }

  function setCableEndSplicerSnap(p, end, slot) {
    end = resolveCableEnd(p, end);
    p.activeCableEnd = end;
    if (end === 'start') {
      p.startIsSnappedToSplicer = true;
      p.startSnappedSplicerId = slot.machineId;
      p.startSnappedSplicerSide = slot.side;
      p.startSplicerGrooveY = slot.grooveY;
      p.startSplicerTipX = p.ax;
      p.startSplicerGrooveAnchor = { x: slot.centerX, y: slot.grooveY };
      p.startSplicerPreviewSlot = null;
      p.startSplicerBareGlassPx = getSplicerExposedBareLengthPxForEnd(p, 'start');
      p.startSplicerInnerEdgeX = slot.innerEdgeX;
    } else {
      p.isSnappedToSplicer = true;
      p.snappedSplicerId = slot.machineId;
      p.snappedSplicerSide = slot.side;
      p.splicerGrooveY = slot.grooveY;
      p.splicerTipX = p.bx;
      p.splicerGrooveAnchor = { x: slot.centerX, y: slot.grooveY };
      p.splicerPreviewSlot = null;
      p.splicerBareGlassPx = getSplicerExposedBareLengthPxForEnd(p, 'end');
      p.splicerInnerEdgeX = slot.innerEdgeX;
    }
  }

  function clearCableEndSplicerSnap(p, end, opts) {
    opts = opts || {};
    end = resolveCableEnd(p, end);
    var snapped = cableEndIsSnappedToSplicer(p, end);
    if (!snapped) return;
    var machineId = end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
    var side = end === 'start' ? p.startSnappedSplicerSide : p.snappedSplicerSide;
    if (end === 'start') {
      p.startIsSnappedToSplicer = false;
      p.startSnappedSplicerId = null;
      p.startSnappedSplicerSide = null;
      p.startSplicerGrooveY = null;
      p.startSplicerTipX = null;
      p.startSplicerPreviewSlot = null;
      p.startSplicerGrooveAnchor = null;
      if (!opts.preserveWeld) {
        p.startSplicerBareGlassPx = null;
        p.startSplicerInnerEdgeX = null;
      }
    } else {
      p.isSnappedToSplicer = false;
      p.snappedSplicerId = null;
      p.snappedSplicerSide = null;
      p.splicerGrooveY = null;
      p.splicerTipX = null;
      p.splicerPreviewSlot = null;
      p.splicerGrooveAnchor = null;
      if (!opts.preserveWeld) {
        p.splicerBareGlassPx = null;
        p.splicerInnerEdgeX = null;
      }
    }
    if (machineId && side && global.FusionSplicerMachine && FusionSplicerMachine.getUI) {
      var api = FusionSplicerMachine.getUI(machineId);
      if (api && typeof api.setFiberPlaced === 'function') {
        api.setFiberPlaced(side, false);
      }
    }
  }

  function getPigtailFiberRenderStrokeWidths() {
    return {
      jacket: PIGTAIL_FIBER_STROKE_JACKET_PX,
      buffer: PIGTAIL_FIBER_STROKE_BUFFER_PX,
      bare: PIGTAIL_FIBER_STROKE_BARE_PX,
    };
  }

  var ctx = null;
  var layer = null;
  var pigtails = [];
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  /** Post-arc weld assemblies — keyed by fusionAssemblyId (one record per fused pair). */
  var fusedAssemblies = {};

  function makeFusionAssemblyId(leftId, rightId) {
    if (!leftId || !rightId) return null;
    return leftId < rightId
      ? ('fa:' + leftId + ':' + rightId)
      : ('fa:' + rightId + ':' + leftId);
  }

  function isFusionAssemblyPermanent(asm) {
    return !!(asm && (asm.permanent || asm.sleeveShrunk));
  }

  function isPigtailFusionPermanent(p, end) {
    if (!p) return false;
    if (isCable(p)) {
      if (end != null) return isMemberEndFusionPermanent(p, end);
      return isMemberEndFusionPermanent(p, 'start') || isMemberEndFusionPermanent(p, 'end');
    }
    return isMemberEndFusionPermanent(p, 'end');
  }

  function getPigtailFusionAssemblyId(p, end) {
    if (!p) return null;
    if (isCable(p)) {
      if (end != null) return getMemberEndFusionAssemblyId(p, end);
      var activeAsm = getMemberEndFusionAssemblyId(p, resolveMemberEnd(p, p.activeCableEnd));
      if (activeAsm) return activeAsm;
      return getMemberEndFusionAssemblyId(p, 'start') || getMemberEndFusionAssemblyId(p, 'end');
    }
    return getMemberEndFusionAssemblyId(p, 'end');
  }

  /** Resolve fused-assembly record for any member (cables may only appear in leftId/rightId). */
  function findFusionAssemblyRecordForMember(p) {
    if (!p) return null;
    var asmId = getPigtailFusionAssemblyId(p);
    if (asmId && fusedAssemblies[asmId]) return fusedAssemblies[asmId];
    if (isCable(p)) {
      if (p.fusionAssemblyId && fusedAssemblies[p.fusionAssemblyId]) {
        return fusedAssemblies[p.fusionAssemblyId];
      }
      if (p.startFusionAssemblyId && fusedAssemblies[p.startFusionAssemblyId]) {
        return fusedAssemblies[p.startFusionAssemblyId];
      }
    }
    var found = null;
    Object.keys(fusedAssemblies).forEach(function (aid) {
      var asm = fusedAssemblies[aid];
      if (asm && (asm.leftId === p.id || asm.rightId === p.id)) found = asm;
    });
    return found;
  }

  /** Which cable end ('start' | 'end') is welded in a fusion assembly, or null. */
  function getCableFusedEnd(p, asm) {
    if (!p || !isCable(p)) return null;
    asm = asm || findFusionAssemblyRecordForMember(p);
    if (!asm) return null;
    if (asm.leftId !== p.id && asm.rightId !== p.id) return null;
    var fusionId = asm.fusionAssemblyId || makeFusionAssemblyId(asm.leftId, asm.rightId);
    if (fusionId && p.startFusionAssemblyId === fusionId) return 'start';
    if (fusionId && p.fusionAssemblyId === fusionId) return 'end';
    var key = asm.leftId === p.id ? asm.leftKey : asm.rightKey;
    var prefix = 'cable:' + p.id + ':';
    if (key && key.indexOf(prefix) === 0) {
      return cableEndFromToken(key.slice(prefix.length));
    }
    if (p.startFusionAssemblyId && !p.fusionAssemblyId) return 'start';
    if (p.fusionAssemblyId && !p.startFusionAssemblyId) return 'end';
    var asmKey = asm.id || asm.fusionAssemblyId || fusionId;
    if (asmKey && p.startFusionAssemblyId === asmKey) return 'start';
    if (asmKey && p.fusionAssemblyId === asmKey) return 'end';
    return null;
  }

  /** Real pigtail/cable from a dock adapter or live object reference. */
  function resolveDockedMember(dockRef) {
    if (!dockRef || !dockRef.id) return null;
    return findPigtail(dockRef.id);
  }

  function dockedMemberCableEnd(dockRef) {
    if (!dockRef) return 'end';
    if (dockRef.cableEnd) return cableEndFromToken(dockRef.cableEnd);
    var p = resolveDockedMember(dockRef);
    if (!p || !isCable(p)) return 'end';
    return resolveCableEnd(p, p.activeCableEnd);
  }

  /** Fusion assembly id for a splicer machine — registry, then real docked members. */
  function resolveFusionAssemblyIdForMachine(machineId) {
    if (!machineId) return null;
    var byMachine = findFusionAssemblyByMachineId(machineId);
    if (byMachine && isFusedAssembly(byMachine)) return byMachine;
    var docked = getSplicerDockedPair(machineId);
    if (!docked.left || !docked.right) return null;
    var leftReal = resolveDockedMember(docked.left);
    var rightReal = resolveDockedMember(docked.right);
    var asmId = (leftReal && getPigtailFusionAssemblyId(leftReal)) ||
      (rightReal && getPigtailFusionAssemblyId(rightReal));
    if (asmId && isFusedAssembly(asmId)) return asmId;
    var fusionId = makeFusionAssemblyId(docked.left.id, docked.right.id);
    return fusionId && isFusedAssembly(fusionId) ? fusionId : null;
  }

  function applyFusionStateToMember(dockRef, fusionId, machineId, side, partnerId) {
    var p = resolveDockedMember(dockRef);
    if (!p || !fusionId) return;
    var cableEnd = dockedMemberCableEnd(dockRef);
    if (isCable(p) && cableEnd === 'start') {
      p.startFusionAssemblyId = fusionId;
      p.startFusedPartnerId = partnerId;
      p.startSplicerWeldMachineId = machineId;
      p.startSplicerFusedSide = side;
      return;
    }
    p.fusionAssemblyId = fusionId;
    p.fusedPartnerId = partnerId;
    p.splicerWeldMachineId = machineId;
    p.splicerFusedSide = side;
  }

  function getFusedMemberWeldWorld(p, asm) {
    if (!p) return null;
    if (isCable(p) && getCableFusedEnd(p, asm) === 'start') {
      return { x: p.ax, y: p.ay };
    }
    return { x: p.bx, y: p.by };
  }

  function getFusionAssemblyMachineId(assemblyId) {
    var asm = assemblyId && fusedAssemblies[assemblyId];
    return asm && asm.machineId ? asm.machineId : null;
  }

  /** Map splicer machine id → fusion assembly id (registry is keyed by fusionAssemblyId). */
  function findFusionAssemblyByMachineId(machineId, prefs) {
    prefs = prefs || {};
    if (!machineId) return null;
    if (fusedAssemblies[machineId]) return machineId;
    var candidates = [];
    Object.keys(fusedAssemblies).forEach(function (aid) {
      var asm = fusedAssemblies[aid];
      if (asm && asm.machineId === machineId) candidates.push(aid);
    });
    if (!candidates.length) return null;
    if (prefs.preferDocked) {
      for (var i = 0; i < candidates.length; i++) {
        if (fusedAssemblies[candidates[i]].isOvenDocked) return candidates[i];
      }
    }
    if (prefs.preferHeating) {
      for (var j = 0; j < candidates.length; j++) {
        var phase = fusedAssemblies[candidates[j]].heatPhase;
        if (phase === 'heating' || phase === 'docked') return candidates[j];
      }
    }
    return candidates[candidates.length - 1];
  }

  function resolveFusionAssemblyId(idOrMachineId, prefs) {
    if (!idOrMachineId) return null;
    if (fusedAssemblies[idOrMachineId]) return idOrMachineId;
    return findFusionAssemblyByMachineId(idOrMachineId, prefs || {});
  }

  function syncGlobalFiberFusedFlag() {
    if (!global.__fiberFusedMachines) global.__fiberFusedMachines = {};
    global.__fiberFusedMachines = {};
    Object.keys(fusedAssemblies).forEach(function (assemblyId) {
      var asm = fusedAssemblies[assemblyId];
      if (asm && asm.machineId) global.__fiberFusedMachines[asm.machineId] = true;
    });
    global.isFiberFused = Object.keys(fusedAssemblies).length > 0;
  }

  function rebuildFusedAssemblyRegistry() {
    var next = {};
    Object.keys(fusedAssemblies).forEach(function (key) {
      var asm = fusedAssemblies[key];
      if (!asm || !asm.leftId || !asm.rightId) return;
      var fusionId = asm.fusionAssemblyId || makeFusionAssemblyId(asm.leftId, asm.rightId);
      asm.fusionAssemblyId = fusionId;
      if (!asm.machineId && key.indexOf('fa:') !== 0) asm.machineId = key;
      next[fusionId] = asm;
    });
    fusedAssemblies = next;
    pigtails.forEach(function (p) {
      if (!p || isCable(p)) return;
      if (isMemberEndFusionPermanent(p, 'end')) return;
      if (p.fusionAssemblyId && fusedAssemblies[p.fusionAssemblyId]) return;
      if (!p.splicerWeldMachineId && !p.fusedPartnerId) return;
      var partner = p.fusedPartnerId ? findPigtail(p.fusedPartnerId) : null;
      if (!partner) {
        pigtails.forEach(function (other) {
          if (other.id === p.id) return;
          if (other.splicerWeldMachineId === p.splicerWeldMachineId &&
              other.splicerWeldMachineId) {
            partner = other;
          }
        });
      }
      if (!partner) return;
      var fusionId = makeFusionAssemblyId(p.id, partner.id);
      if (!fusionId) return;
      p.fusionAssemblyId = fusionId;
      partner.fusionAssemblyId = fusionId;
      p.fusedPartnerId = partner.id;
      partner.fusedPartnerId = p.id;
      if (!fusedAssemblies[fusionId]) {
        fusedAssemblies[fusionId] = {
          fusionAssemblyId: fusionId,
          machineId: p.splicerWeldMachineId,
          leftId: fusionId.indexOf(p.id) === 3 ? p.id : partner.id,
          rightId: fusionId.indexOf(partner.id) > 0 ? partner.id : p.id,
          sleeveShrunk: !!(p.isSleeveShrunk || partner.isSleeveShrunk),
          permanent: isMemberEndFusionPermanent(p, 'end') ||
            isMemberEndFusionPermanent(partner, 'end'),
        };
      }
    });
    Object.keys(fusedAssemblies).forEach(function (fusionId) {
      var asm = fusedAssemblies[fusionId];
      if (!asm || !asm.leftId || !asm.rightId) return;
      var leftPg = findPigtail(asm.leftId);
      var rightPg = findPigtail(asm.rightId);
      if (leftPg) {
        var leftEnd = getCableFusedEnd(leftPg, asm) || 'end';
        applyFusionStateToMember(
          isCable(leftPg) ? cableSplicerDockAdapter(leftPg, leftEnd) : leftPg,
          fusionId,
          asm.machineId,
          'L',
          asm.rightId
        );
      }
      if (rightPg) {
        var rightEnd = getCableFusedEnd(rightPg, asm) || 'end';
        applyFusionStateToMember(
          isCable(rightPg) ? cableSplicerDockAdapter(rightPg, rightEnd) : rightPg,
          fusionId,
          asm.machineId,
          'R',
          asm.leftId
        );
      }
    });
    syncGlobalFiberFusedFlag();
    syncGlobalSleeveShrunkFlag();
  }

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

  function getSleeveSizePx() {
    if (global.FtthLab && typeof FtthLab.getSleeveSizePx === 'function') {
      return FtthLab.getSleeveSizePx();
    }
    return { w: 56, h: 8 };
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
      FtthLab.setSelectionOwner('sc-pigtail');
    }
  }

  function cloneJson(v) {
    return JSON.parse(JSON.stringify(v == null ? null : v));
  }

  function normalizePolish(v) {
    var s = String(v || '').toUpperCase().replace(/\s+/g, '');
    if (s === 'APC' || s === 'SC/APC' || s === 'SCAPC') return 'APC';
    return 'PC';
  }

  function displayPolish(v) {
    return normalizePolish(v) === 'APC' ? 'SC/APC' : 'SC/PC';
  }

  function portPolishNorm(v) {
    return String(v || '').toUpperCase() === 'APC' ? 'APC' : 'PC';
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

  function findPigtail(id) {
    for (var i = 0; i < pigtails.length; i++) {
      if (pigtails[i].id === id) return pigtails[i];
    }
    return null;
  }

  function dist2(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * CSS rotate(θ) with y+ down — identical to patch cord:
   *   bootOutDir(θ) = (−sin θ, cos θ) aims local +Y (boot → cable).
   *   θ = atan2(−tx, ty) aims boot toward the other end.
   */
  function endRotationDeg(cx, cy, towardX, towardY) {
    var tx = towardX - cx;
    var ty = towardY - cy;
    return Math.atan2(-tx, ty) * 180 / Math.PI;
  }

  function bootOutDir(rotDeg) {
    var r = rotDeg * Math.PI / 180;
    return { x: -Math.sin(r), y: Math.cos(r) };
  }

  function localToWorld(cx, cy, lx, ly, rotDeg) {
    var r = rotDeg * Math.PI / 180;
    var cos = Math.cos(r);
    var sin = Math.sin(r);
    return {
      x: cx + lx * cos - ly * sin,
      y: cy + lx * sin + ly * cos,
    };
  }

  function lerpAngleDeg(from, to, t) {
    var d = ((to - from + 540) % 360) - 180;
    return from + d * t;
  }

  /** Ferrule/nose leads along (dx, dy) — same as patch cord. */
  function headingRotFromMotion(dx, dy) {
    return Math.atan2(dx, -dy) * 180 / Math.PI;
  }

  /**
   * Sleeve long axis parallel to fiber tangent (CSS y+ down).
   * headingRotFromMotion is +90° off — do not use for sleeve alignment.
   */
  function fiberPathTangentRotDeg(dx, dy) {
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return 0;
    return Math.atan2(dy, dx) * 180 / Math.PI;
  }

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
      return hit.port === 'B' || hit.port === 'b' ? -90 : 90;
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
    return 0;
  }

  function resolveUprightPlugRotation(hit, p) {
    if (hit && hit.owner === 'coupler') return portAlignedRotation(hit);
    /* OPM / VFL / OLS top adapters: always ferrule-down / cable-up */
    if (hit && (hit.owner === 'vfl' || hit.owner === 'opm' || hit.owner === 'ols')) return 180;
    /* Angled SFP cages seat along the module axis — never flip to upright */
    if (oltPortSeatRotation(hit) != null) return portAlignedRotation(hit);
    var base = portAlignedRotation(hit);
    var alt = base === 0 ? 180 : 0;
    var dY = (hit && typeof hit.wy === 'number') ? (hit.wy - p.ay) : 0;
    if (Math.abs(dY) < 1) return base;
    var preferred = headingRotFromMotion(0, dY);
    var dBase = Math.abs(((preferred - base + 540) % 360) - 180);
    var dAlt = Math.abs(((preferred - alt + 540) % 360) - 180);
    return dAlt < dBase ? alt : base;
  }

  function olsMagnetRadius() {
    if (global.FtthLab && typeof FtthLab.getOlsMagnetSnapPx === 'function') {
      var n = Number(FtthLab.getOlsMagnetSnapPx());
      if (isFinite(n) && n > 0) return n;
    }
    return OLS_MAGNET_SNAP_PX;
  }

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

  function isOtdrPortEl(el) {
    return !!(el && el.closest && el.closest('.lab-otdr-port, .lab-otdr-device .device-port'));
  }

  function isOtdrPortHit(hit) {
    return !!(hit && (hit.otdr || isOtdrPortEl(hit.el)));
  }

  /** True when a plugged connector/cord end is seated on a SmartOTDR port. */
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

  function magnetRadiusForEl(el) {
    if (isOtdrPortEl(el)) return OTDR_MAGNET_SNAP_PX;
    if (el && el.closest && el.closest('.lab-ols-port[data-ols-port]')) return olsMagnetRadius();
    if (el && el.closest && el.closest('.lab-opm-port[data-opm-port]')) return OPM_MAGNET_SNAP_PX;
    return PLUG_SNAP_PX * 3;
  }

  function plugSnapRadiusFor(hit) {
    if (!hit) return PLUG_SNAP_PX * 3;
    if (isOtdrPortHit(hit)) return OTDR_PLUG_SNAP_PX;
    if (hit.owner === 'ols') return olsMagnetRadius();
    if (hit.owner === 'opm' || hit.owner === 'vfl') return OPM_MAGNET_SNAP_PX;
    return PLUG_SNAP_PX * 3;
  }

  function magnetLockPxFor(hit) {
    if (isOtdrPortHit(hit)) return 28;
    if (hit && hit.owner === 'opm') return 26;
    return OLS_MAGNET_LOCK_PX;
  }

  function opmPortScreenCenter(el) {
    if (!el) return null;
    var knurl = el.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || el;
    var r = knurl.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height * 0.35 };
  }

  function enrichOlsHitDeepSeat(hit) {
    if (!hit || hit.owner !== 'ols' || !hit.olsId) return hit;
    if (isOtdrPortHit(hit) || String(hit.olsId).indexOf('otdr') >= 0) {
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

  function findNearestOlsHit(clientX, clientY, maxPx) {
    var nodes = document.querySelectorAll('.lab-ols-port[data-ols-port]');
    var best = null;
    var bestD = Infinity;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var c = olsPortScreenCenter(node);
      if (!c) continue;
      var radius = maxPx != null ? maxPx : magnetRadiusForEl(node);
      var d = dist2(clientX, clientY, c.x, c.y);
      if (d <= radius && d < bestD) {
        bestD = d;
        var otdrMeta = otdrPortMetaFromNode(node);
        best = {
          owner: 'ols',
          olsId: node.getAttribute('data-ols-port'),
          polish: otdrMeta ? otdrMeta.polish : 'UPC',
          connectorType: 'SC',
          label: otdrMeta ? otdrMeta.label : 'Viavi OLS-35 · SC adapter',
          el: node,
          screenDist: d,
          otdr: isOtdrPortEl(node),
        };
        enrichOlsHitDeepSeat(best);
      }
    }
    return best;
  }

  function findNearestOpmHit(clientX, clientY, maxPx) {
    var nodes = document.querySelectorAll('.lab-opm-port[data-opm-port]');
    var best = null;
    var bestD = Infinity;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      var c = opmPortScreenCenter(node);
      if (!c) continue;
      var radius = maxPx != null ? maxPx : magnetRadiusForEl(node);
      var d = dist2(clientX, clientY, c.x, c.y);
      if (d <= radius && d < bestD) {
        bestD = d;
        var oid = node.getAttribute('data-opm-port');
        var otdrOpm = otdrPortMetaFromNode(node);
        var cO = clientToWorld(c.x, c.y);
        best = {
          owner: 'opm',
          opmId: oid,
          polish: otdrOpm ? otdrOpm.polish : 'UPC',
          universal: isUniversalPortEl(node),
          connectorType: 'SC',
          label: otdrOpm ? otdrOpm.label : 'Viavi OLP-38 · SC adapter',
          wx: cO.x,
          wy: cO.y,
          el: node,
          screenDist: d,
          otdr: isOtdrPortEl(node),
        };
        if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
          var pw = FtthLab.getOpmPortWorld(oid);
          if (pw) {
            best.wx = pw.x;
            best.wy = pw.y;
          }
        }
      }
    }
    return best;
  }

  function resolvePlugHit(clientX, clientY) {
    var hit = hitTestPort(clientX, clientY);
    if (hit && hit.owner === 'ols') {
      enrichOlsHitDeepSeat(hit);
      var c = olsPortScreenCenter(hit.el);
      if (c) hit.screenDist = dist2(clientX, clientY, c.x, c.y);
      if (isOtdrPortEl(hit.el)) hit.otdr = true;
      return hit;
    }
    if (hit && hit.owner === 'opm') {
      var cOpm = opmPortScreenCenter(hit.el);
      if (cOpm) hit.screenDist = dist2(clientX, clientY, cOpm.x, cOpm.y);
      if (isOtdrPortEl(hit.el)) hit.otdr = true;
      return hit;
    }
    var ols = findNearestOlsHit(clientX, clientY);
    if (ols) return ols;
    var opm = findNearestOpmHit(clientX, clientY);
    if (opm) return opm;
    return hit;
  }

  function applyOlsMagneticPull(p, hit, clientX, clientY) {
    if (!hit || hit.owner !== 'ols' || !p) return null;
    enrichOlsHitDeepSeat(hit);
    var c = olsPortScreenCenter(hit.el);
    var d = hit.screenDist != null
      ? hit.screenDist
      : (c ? dist2(clientX, clientY, c.x, c.y) : 9999);
    var maxR = isOtdrPortHit(hit) ? OTDR_MAGNET_SNAP_PX : olsMagnetRadius();
    if (d > maxR) return null;
    if (hit.el) hit.el.classList.add('is-plug-target');
    p.connector.liveRot = 180;
    seatConnectorAtPort(p, hit.wx, hit.wy);
    updateFiberPath(p);
    if (d <= magnetLockPxFor(hit)) return 'lock';
    return 'pull';
  }

  function applyOpmMagneticPull(p, hit, clientX, clientY) {
    if (!hit || hit.owner !== 'opm' || !p) return null;
    var c = opmPortScreenCenter(hit.el);
    var d = hit.screenDist != null
      ? hit.screenDist
      : (c ? dist2(clientX, clientY, c.x, c.y) : 9999);
    if (d > plugSnapRadiusFor(hit)) return null;
    if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function' && hit.opmId) {
      var pw = FtthLab.getOpmPortWorld(hit.opmId);
      if (pw) {
        hit.wx = pw.x;
        hit.wy = pw.y;
      }
    }
    if (hit.el) hit.el.classList.add('is-plug-target');
    p.connector.liveRot = 180;
    seatConnectorAtPort(p, hit.wx, hit.wy);
    updateFiberPath(p);
    if (d <= magnetLockPxFor(hit)) return 'lock';
    return 'pull';
  }

  function captureSnapshot() {
    return {
      pigtails: cloneJson(pigtails),
      fusedAssemblies: cloneJson(fusedAssemblies),
      seq: seq,
    };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    pigtails = cloneJson(snap.pigtails) || [];
    fusedAssemblies = cloneJson(snap.fusedAssemblies) || {};
    pigtails.forEach(function (p) {
      if (!p) return;
      p.hasSleeve = !!p.hasSleeve;
      if (p.hasSleeve && typeof p.sleeveAlong !== 'number') {
        p.sleeveAlong = 0;
      }
      if (!p.hasSleeve) p.sleeveAlong = null;
      if (isCable(p)) {
        p.startHasSleeve = !!p.startHasSleeve;
        if (p.startHasSleeve && typeof p.startSleeveAlong !== 'number') {
          p.startSleeveAlong = 0;
        }
        if (!p.startHasSleeve) p.startSleeveAlong = null;
      }
      p.jacketColor = normalizeJacketColorName(p.jacketColor);
      if (typeof p.stripStage !== 'number') p.stripStage = 0;
      if (typeof p.stripPeel !== 'number') p.stripPeel = 0;
      if (p.stripStage < 0) p.stripStage = 0;
      if (p.stripStage > 2) p.stripStage = 2;
      if (typeof p.stripLengthPx !== 'number') p.stripLengthPx = 0;
      p.isStripped = !!(p.isStripped || (Number(p.stripStage) || 0) >= 1 || p.stripFrontierLock);
      p.isCleaned = !!p.isCleaned;
      ensureFiberStrip(p);
      if (isCable(p)) syncCablePrepState(p);
      else ensurePigtailPrepState(p);
      p.cleaved = !!p.cleaved;
      p.isCleaved = !!(p.isCleaved || p.cleaved);
      p.cleaved = p.isCleaved;
      if (typeof p.cleaveAngle !== 'number') {
        p.cleaveAngle = p.isCleaved ? 90 : 0;
      }
      if (p.isCleaved) {
        restoreCleavedStripLock(p);
      } else {
        p.cleavedStripLock = null;
      }
      if ((Number(p.stripStage) || 0) >= 2 || p.stripFrontierLock) {
        restorePermanentStripFrontier(p);
      } else {
        p.stripFrontierLock = null;
        clampStripFrontiersToPath(p);
      }
      if (!Array.isArray(p.pathHistory)) {
        p.pathHistory = Array.isArray(p.route) ? cloneJson(p.route) : [];
      }
      if (!Array.isArray(p.route)) p.route = p.pathHistory.slice();
      else p.route = p.pathHistory.slice();
      p.routeMode = p.routeMode === 'gravity' ? 'gravity' : 'snake';
      p.snake = null;
      p.isSnappedToCleaver = !!p.isSnappedToCleaver;
      if (!p.isSnappedToCleaver || !p.snappedCleaverId) {
        p.isSnappedToCleaver = false;
        p.snappedCleaverId = null;
        p.cleaverSlotAnchorX = null;
      }
      p.isSnappedToSplicer = !!p.isSnappedToSplicer;
      if (!p.isSnappedToSplicer || !p.snappedSplicerId || !p.snappedSplicerSide) {
        p.isSnappedToSplicer = false;
        p.snappedSplicerId = null;
        p.snappedSplicerSide = null;
        p.splicerGrooveY = null;
        p.splicerTipX = null;
        p.splicerPreviewSlot = null;
        if (!isFusionEndLiftedFromSplicer(p, 'end')) {
          p.splicerDragDetached = false;
        }
        p.splicerGrooveAnchor = null;
        p.splicerBareGlassPx = null;
        p.splicerInnerEdgeX = null;
        p.splicerDockSnapshot = null;
        if (!isMemberEndFusionPermanent(p, 'end') &&
            !shouldProtectFusionFieldsFromMachineClear(p, 'end')) {
          p.splicerWeldMachineId = null;
          p.fusionAssemblyId = null;
          p.fusedPartnerId = null;
          p.fusedJacketEndDist = null;
          p.splicerFusedSide = null;
        }
      }
      if (isCable(p)) {
        p.startIsSnappedToSplicer = !!p.startIsSnappedToSplicer;
        if (!p.startIsSnappedToSplicer || !p.startSnappedSplicerId || !p.startSnappedSplicerSide) {
          p.startIsSnappedToSplicer = false;
          p.startSnappedSplicerId = null;
          p.startSnappedSplicerSide = null;
          p.startSplicerGrooveY = null;
          p.startSplicerTipX = null;
          p.startSplicerPreviewSlot = null;
          if (!isFusionEndLiftedFromSplicer(p, 'start')) {
            p.startSplicerDragDetached = false;
          }
          p.startSplicerGrooveAnchor = null;
          p.startSplicerBareGlassPx = null;
          p.startSplicerInnerEdgeX = null;
          p.startSplicerDockSnapshot = null;
          if (!isMemberEndFusionPermanent(p, 'start') &&
              !shouldProtectFusionFieldsFromMachineClear(p, 'start')) {
            p.startSplicerWeldMachineId = null;
            p.startFusionAssemblyId = null;
            p.startFusedPartnerId = null;
            p.startFusedJacketEndDist = null;
            p.startSplicerFusedSide = null;
          }
        }
      }
      if (p.connector && p.connector.attached) {
        normalizeOtdrAttachmentFields(p.connector.attached);
      }
    });
    rebuildFusedAssemblyRegistry();
    seq = snap.seq || 0;
    selection = { kind: 'none', id: null };
    rebuildLayer();
    renderSplicerFiberOverlays();
    updateInspector();
    refreshBudget();
    historyLocked = false;
  }

  /**
   * Bare-fiber path for sleeve sliding: 0% = cleaved tip (End B), 100% = strain relief.
   */
  function fiberSleevePathPoints(p) {
    return fiberRenderPathPointsDense(p).slice().reverse();
  }

  function polylineLength(pts) {
    var len = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      len += dist2(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
    }
    return len;
  }

  function defaultSleeveAlong(totalLen, sleeveW) {
    if (!totalLen || totalLen < 1) return 0;
    return Math.min(1, (sleeveW * 0.48) / totalLen);
  }

  function pushSleevePathPt(out, pt) {
    if (!pt) return;
    if (
      out.length &&
      Math.abs(out[out.length - 1].x - pt.x) < 0.25 &&
      Math.abs(out[out.length - 1].y - pt.y) < 0.25
    ) {
      return;
    }
    out.push({ x: pt.x, y: pt.y });
  }

  function sampleQuadraticArc(p0, cp, p1, steps) {
    var out = [];
    var i;
    steps = Math.max(2, steps || 10);
    for (i = 1; i <= steps; i++) {
      var t = i / steps;
      var mt = 1 - t;
      out.push({
        x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * p1.x,
        y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * p1.y,
      });
    }
    return out;
  }

  /** Dense world points along filleted ortho route (matches visible fiber fillets). */
  function sampleFilletOrthoPoints(pts, radius) {
    pts = collapseOrthoPts(pts);
    if (!pts.length) return [];
    if (pts.length < 2) return [{ x: pts[0].x, y: pts[0].y }];
    var rMax = Math.max(8, Math.min(24, radius != null ? radius : ORTHO_FILLET_R));
    var out = [];
    var i;
    pushSleevePathPt(out, pts[0]);
    if (pts.length === 2) {
      pushSleevePathPt(out, pts[1]);
      return out;
    }
    for (i = 1; i < pts.length - 1; i++) {
      var prev = pts[i - 1];
      var mid = pts[i];
      var next = pts[i + 1];
      var v1x = mid.x - prev.x;
      var v1y = mid.y - prev.y;
      var v2x = next.x - mid.x;
      var v2y = next.y - mid.y;
      var len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r = Math.min(rMax, len1 * 0.5, len2 * 0.5);
      if (r < 2) {
        pushSleevePathPt(out, mid);
        continue;
      }
      var before = {
        x: mid.x - (v1x / len1) * r,
        y: mid.y - (v1y / len1) * r,
      };
      var after = {
        x: mid.x + (v2x / len2) * r,
        y: mid.y + (v2y / len2) * r,
      };
      pushSleevePathPt(out, before);
      sampleQuadraticArc(before, mid, after, 10).forEach(function (pt) {
        pushSleevePathPt(out, pt);
      });
    }
    pushSleevePathPt(out, pts[pts.length - 1]);
    return out;
  }

  function pointAtPathDistance(pts, dist) {
    if (!pts || !pts.length) {
      return { x: 0, y: 0, rot: 0, dist: 0, t: 0 };
    }
    if (pts.length === 1) {
      return { x: pts[0].x, y: pts[0].y, rot: 0, dist: 0, t: 0 };
    }
    var total = polylineLength(pts);
    if (dist <= 0) {
      var dx0 = pts[1].x - pts[0].x;
      var dy0 = pts[1].y - pts[0].y;
      return {
        x: pts[0].x,
        y: pts[0].y,
        rot: fiberPathTangentRotDeg(dx0, dy0),
        dist: 0,
        t: 0,
      };
    }
    if (dist >= total) {
      var last = pts.length - 1;
      var dxL = pts[last].x - pts[last - 1].x;
      var dyL = pts[last].y - pts[last - 1].y;
      return {
        x: pts[last].x,
        y: pts[last].y,
        rot: fiberPathTangentRotDeg(dxL, dyL),
        dist: total,
        t: 1,
      };
    }
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segLen = dist2(ax, ay, bx, by);
      if (acc + segLen >= dist) {
        var u = segLen > 0 ? (dist - acc) / segLen : 0;
        return {
          x: ax + (bx - ax) * u,
          y: ay + (by - ay) * u,
          rot: fiberPathTangentRotDeg(bx - ax, by - ay),
          dist: dist,
          t: total > 0 ? dist / total : 0,
        };
      }
      acc += segLen;
    }
    return pointAtPathDistance(pts, total);
  }

  function projectOntoFiberPath(pts, wx, wy, allowFarExtrapolate) {
    if (!pts || pts.length < 2) {
      return { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: 0 };
    }
    var total = polylineLength(pts);
    var best = null;
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segDx = bx - ax;
      var segDy = by - ay;
      var segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      var segLen2 = segLen * segLen;
      var u = segLen2 > 0 ? ((wx - ax) * segDx + (wy - ay) * segDy) / segLen2 : 0;
      var uClamped = Math.max(0, Math.min(1, u));
      var px = ax + segDx * uClamped;
      var py = ay + segDy * uClamped;
      var perp = dist2(wx, wy, px, py);
      var along = acc + uClamped * segLen;
      var cand = {
        x: px,
        y: py,
        rot: fiberPathTangentRotDeg(segDx, segDy),
        dist: along,
        t: total > 0 ? along / total : 0,
        perpDist: perp,
      };
      if (!best || perp < best.perpDist) best = cand;
      acc += segLen;
    }
    /* Extrapolate before the bare tip so backward pull can eject. */
    var ax0 = pts[0].x;
    var ay0 = pts[0].y;
    var bx0 = pts[1].x;
    var by0 = pts[1].y;
    var segDx0 = bx0 - ax0;
    var segDy0 = by0 - ay0;
    var segLen0 = Math.sqrt(segDx0 * segDx0 + segDy0 * segDy0) || 1;
    var u0 = ((wx - ax0) * segDx0 + (wy - ay0) * segDy0) / (segLen0 * segLen0);
    if (u0 < 0) {
      var px0 = ax0 + segDx0 * u0;
      var py0 = ay0 + segDy0 * u0;
      var perp0 = dist2(wx, wy, px0, py0);
      var along0 = u0 * segLen0;
      if (!best || perp0 <= best.perpDist + 6) {
        best = {
          x: px0,
          y: py0,
          rot: fiberPathTangentRotDeg(segDx0, segDy0),
          dist: along0,
          t: total > 0 ? along0 / total : 0,
          perpDist: perp0,
        };
      }
    }
    /* Cable sleeves only: extrapolate past far tip for opposite-end ejection. */
    if (allowFarExtrapolate) {
      var last = pts.length - 1;
      var axL = pts[last - 1].x;
      var ayL = pts[last - 1].y;
      var bxL = pts[last].x;
      var byL = pts[last].y;
      var segDxL = bxL - axL;
      var segDyL = byL - ayL;
      var segLenL = Math.sqrt(segDxL * segDxL + segDyL * segDyL) || 1;
      var uL = ((wx - axL) * segDxL + (wy - ayL) * segDyL) / (segLenL * segLenL);
      if (uL > 1) {
        var pxL = axL + segDxL * uL;
        var pyL = ayL + segDyL * uL;
        var perpL = dist2(wx, wy, pxL, pyL);
        var alongL = total + (uL - 1) * segLenL;
        if (!best || perpL <= best.perpDist + 6) {
          best = {
            x: pxL,
            y: pyL,
            rot: fiberPathTangentRotDeg(segDxL, segDyL),
            dist: alongL,
            t: total > 0 ? alongL / total : 0,
            perpDist: perpL,
          };
        }
      }
    }
    return best || { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: 0 };
  }

  /**
   * Sleeve pose locked to fiber path coordinate (sleeveAlong: 0% tip → 100% strain relief).
   * When heat-shrunk, pose locks to the fused weld point and cable tangent at the tip.
   */
  function getPigtailFiberTangentRotAtTip(p) {
    if (!p) return 0;
    var densePts = fiberRenderPathPointsDense(p);
    if (!densePts || densePts.length < 2) {
      return fiberPathTangentRotDeg(p.bx - p.ax, p.by - p.ay);
    }
    var total = polylineLength(densePts);
    var tip = densePts[densePts.length - 1];
    var lookBack = Math.min(28, Math.max(8, total * 0.12));
    var near = pointAtPathDistance(densePts, Math.max(0, total - lookBack));
    var dx = tip.x - near.x;
    var dy = tip.y - near.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
      var prev = densePts[densePts.length - 2];
      dx = tip.x - prev.x;
      dy = tip.y - prev.y;
    }
    return fiberPathTangentRotDeg(dx, dy);
  }

  function isLabFiberDragActive() {
    if (typeof document === 'undefined' || !document.body) return false;
    return (
      document.body.classList.contains('lab-pigtail-dragging') ||
      document.body.classList.contains('lab-sleeve-dragging')
    );
  }

  /** Live weld midpoint from translated member tips — not registry meetX/bridgeY. */
  function getLiveFusedAssemblyWeldWorld(asmId) {
    if (!asmId) return null;
    var pair = getFusedAssemblyPigtails(asmId);
    if (!pair.left) return null;
    var asm = fusedAssemblies[asmId] || findFusionAssemblyByMachineId(asmId);
    var weldL = getFusedMemberWeldWorld(pair.left, asm);
    var weldR = pair.right ? getFusedMemberWeldWorld(pair.right, asm) : null;
    if (weldL && weldR) {
      return { x: (weldL.x + weldR.x) / 2, y: (weldL.y + weldR.y) / 2 };
    }
    return weldL || weldR;
  }

  function getShrunkSleeveWeldPose(p, end) {
    if (!p) return { x: 0, y: 0, rot: 0 };
    var sleeveEnd = resolveSleeveEnd(p, end);
    var rot = isCable(p)
      ? getCableEndFiberTangentRotAtTip(p, sleeveEnd)
      : getPigtailFiberTangentRotAtTip(p);
    var asmId = getMemberEndFusionAssemblyId(p, sleeveEnd) || getPigtailFusionAssemblyId(p, sleeveEnd);
    if (asmId) {
      var weld = isLabFiberDragActive()
        ? getLiveFusedAssemblyWeldWorld(asmId)
        : getFusedWeldWorld(asmId);
      if (weld) return { x: weld.x, y: weld.y, rot: rot };
    }
    if (isCable(p)) {
      var tip = cableEndTipWorld(p, sleeveEnd);
      return { x: tip.x, y: tip.y, rot: rot };
    }
    return { x: p.bx, y: p.by, rot: rot };
  }

  function sleeveGeometry(p, end) {
    var size = getSleeveSizePx();
    var sleeveEnd = resolveSleeveEnd(p, end);
    if (isMemberEndSleeveShrunk(p, sleeveEnd)) {
      var weldPose = getShrunkSleeveWeldPose(p, sleeveEnd);
      return {
        x: weldPose.x,
        y: weldPose.y,
        rot: weldPose.rot,
        w: size.w,
        h: size.h,
      };
    }
    var pts = sleeveSlidePathPoints(p, sleeveEnd);
    var total = polylineLength(pts);
    var along = getSleeveAlongValue(p, sleeveEnd);
    var pt = pointAtPathDistance(pts, along * total);
    return {
      x: pt.x,
      y: pt.y,
      rot: pt.rot,
      w: size.w,
      h: size.h,
    };
  }

  function sleeveStyle(p, end) {
    end = resolveSleeveEnd(p, end);
    var g = sleeveGeometry(p, end);
    var h = g.h;
    if (isMemberEndSleeveShrunk(p, end)) {
      h = Math.max(3, g.h * 0.62);
    }
    return (
      'left:' + Math.round(g.x - g.w / 2) + 'px;' +
      'top:' + Math.round(g.y - h / 2) + 'px;' +
      'width:' + g.w + 'px;' +
      'height:' + h + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + g.rot.toFixed(2) + 'deg)'
    );
  }

  function triggerSleeveSlideIn(id) {
    var el = layer && layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + id + '"]');
    if (!el) return;
    el.classList.add('is-sliding');
    window.setTimeout(function () {
      if (el && el.classList) el.classList.remove('is-sliding');
    }, 420);
  }

  function clearSleeveHeatShrinkInlineStyles(el) {
    if (!el || !el.style) return;
    el.style.removeProperty('left');
    el.style.removeProperty('top');
    el.style.removeProperty('width');
    el.style.removeProperty('height');
    el.style.removeProperty('transform');
    el.style.removeProperty('transform-origin');
  }

  function updateSleeveElement(p, el, end) {
    if (!el || !p) return;
    end = resolveSleeveEnd(p, end);
    if (!pigtailEndHasSleeve(p, end)) return;
    var shrunk = isMemberEndSleeveShrunk(p, end);
    if (shrunk) clearSleeveHeatShrinkInlineStyles(el);
    el.setAttribute('style', sleeveStyle(p, end));
    el.classList.toggle('is-heat-shrunk', shrunk);
    el.classList.toggle('is-heat-shrinking', shrunk && !isLabFiberDragActive());
  }

  function repaintPigtailSleeveDom(p) {
    if (!layer || !p) return;
    if (isCable(p)) {
      ['start', 'end'].forEach(function (end) {
        if (!pigtailEndHasSleeve(p, end)) return;
        var el = layer.querySelector(
          '.lab-pigtail-sleeve[data-pt-sleeve="' + fiberTargetId(p, end) + '"]'
        );
        if (el) updateSleeveElement(p, el, end);
      });
      return;
    }
    if (!p.hasSleeve) return;
    var el = layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + p.id + '"]');
    if (el) updateSleeveElement(p, el, 'end');
  }

  function dragSleeveAlongPath(p, wx, wy, end) {
    if (p && isMemberEndSleeveShrunk(p, end)) return { eject: false, locked: true };
    var sleeveEnd = resolveSleeveEnd(p, end);
    var pts = sleeveSlidePathPoints(p, sleeveEnd);
    var total = polylineLength(pts);
    var cableSleeve = isCable(p);
    var proj = projectOntoFiberPath(pts, wx, wy, cableSleeve);
    if (proj.dist < -SLEEVE_EJECT_PULL_PX) {
      return { eject: true, x: wx, y: wy };
    }
    if (cableSleeve && proj.dist > total + SLEEVE_EJECT_PULL_PX) {
      return { eject: true, x: wx, y: wy };
    }
    setSleeveAlongValue(
      p,
      sleeveEnd,
      total > 0 ? Math.max(0, Math.min(1, proj.dist / total)) : 0
    );
    if (isCable(p)) syncCablePrepState(p);
    return { eject: false, proj: proj };
  }

  function stripStageLabel(stage) {
    if (stage >= 2) return 'Bare glass (125 µm)';
    if (stage >= 1) return 'Buffer exposed · strip acrylate';
    return 'Jacketed · peel outer sheath';
  }

  /**
   * Layered strip state from tip (arc-length px on fiberSleevePathPoints):
   *   [0, bareTo) bare glass · [bareTo, jacketTo) buffer · [jacketTo, total) jacket
   */
  function ensureFiberStrip(p) {
    if (!p) return null;
    if (!p.fiberStrip || typeof p.fiberStrip !== 'object') {
      p.fiberStrip = { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null };
    }
    var fs = p.fiberStrip;
    if (typeof fs.jacketTo !== 'number' || !isFinite(fs.jacketTo)) {
      fs.jacketTo = Number(p.stripLengthPx) || 0;
    }
    if (typeof fs.bareTo !== 'number' || !isFinite(fs.bareTo)) {
      var st = Number(p.stripStage) || 0;
      fs.bareTo = st >= 2 ? fs.jacketTo : 0;
    }
    if (typeof fs.peel !== 'number' || !isFinite(fs.peel)) {
      fs.peel = Number(p.stripPeel) || 0;
    }
    if (fs.jacketTo < 0) fs.jacketTo = 0;
    if (fs.bareTo < 0) fs.bareTo = 0;
    if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    enforceFullStripBareFrontier(p);
    return fs;
  }

  function isFullyStrippedPigtail(p) {
    if (!p) return false;
    if (p.isCleaved || p.cleaved) return true;
    return (Number(p.stripStage) || 0) >= 2;
  }

  /** Stage 2 / cleaved: zero buffer gap — bare glass runs tip → jacket frontier. */
  function enforceFullStripBareFrontier(p) {
    if (!p || !isFullyStrippedPigtail(p) || !p.fiberStrip) return false;
    snapBareToJacket(p.fiberStrip);
    return true;
  }

  function maxStripLenPx(p) {
    var pts = fiberSleevePathPoints(p);
    return Math.max(0, polylineLength(pts));
  }

  /**
   * Cleaved bare-glass length (world px) — single source of truth for cleaver + splicer.
   * Admin-configurable via FtthLabSettings (`bareGlassLengthAfterCutPx`, default 16).
   */
  function getBareGlassLengthAfterCutPx() {
    var settings =
      global.FtthLab && typeof global.FtthLab.getLabSettings === 'function'
        ? global.FtthLab.getLabSettings()
        : global.FtthLabSettings;
    if (settings && typeof settings.getItem === 'function') {
      var item = settings.getItem('fiber-cleaver');
      if (item && item.specs) {
        var n = Number(item.specs.bareGlassLengthAfterCutPx);
        if (isFinite(n) && n >= 1) return Math.round(n);
      }
    }
    return DEFAULT_CLEAVED_GLASS_LENGTH_PX;
  }

  /** Bare glass protrusion from clamp inner edge when docked on splicer (world px). */
  function getSplicerExposedBareLengthPx(p) {
    if (p && (p.cleaved || p.isCleaved)) {
      return getBareGlassLengthAfterCutPx();
    }
    return Math.max(CLEAVE_MIN_CUT_PX, getBareGlassDrawLengthPx(p));
  }

  function restoreCableEndCleavedStripLock(p, end) {
    end = resolveCableEnd(p, end);
    if (!isCable(p)) {
      restoreCleavedStripLock(p);
      return;
    }
    if (!isCableEndCleaved(p, end)) return;
    var fs = ensureCableEndStrip(p, end);
    var lock = end === 'start' ? p.startCleavedStripLock : p.cleavedStripLock;
    if (!lock) {
      var boundary = getJacketBoundaryWorld(p, end);
      var rulerStopX = end === 'start' ? p.startCleaverSlotAnchorX : p.cleaverSlotAnchorX;
      lock = {
        jacketTo: fs.jacketTo || 0,
        bareTo: fs.bareTo || 0,
        jacketBoundaryX: boundary ? boundary.x : null,
        rulerStopX: rulerStopX,
      };
      if (end === 'start') p.startCleavedStripLock = lock;
      else p.cleavedStripLock = lock;
    }
    var maxLen = maxCableEndStripLenPx(p, end);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    fs.jacketTo = j;
    fs.bareTo = j;
    fs.peel = 0;
    fs.peelLayer = null;
    lock.jacketTo = j;
    lock.bareTo = j;
    setCableEndStripStage(p, end, 2);
    syncCablePrepState(p);
  }

  function lockCableEndStripFrontier(p, end) {
    if (!p) return;
    end = resolveCableEnd(p, end);
    if (!isCable(p)) {
      lockPermanentStripFrontier(p);
      return;
    }
    if (getCableEndStripStage(p, end) < 2) return;
    var fs = ensureCableEndStrip(p, end);
    var lock = {
      jacketTo: fs.jacketTo || 0,
      bareTo: fs.bareTo || 0,
      stripStage: 2,
    };
    if (end === 'start') p.startStripFrontierLock = lock;
    else p.stripFrontierLock = lock;
  }

  function restoreCableEndStripFrontier(p, end) {
    if (!p) return false;
    end = resolveCableEnd(p, end);
    if (!isCable(p)) return restorePermanentStripFrontier(p);
    if (isCableEndCleaved(p, end)) {
      restoreCableEndCleavedStripLock(p, end);
      lockCableEndStripFrontier(p, end);
      return true;
    }
    var lock = end === 'start' ? p.startStripFrontierLock : p.stripFrontierLock;
    if (getCableEndStripStage(p, end) >= 2 && !lock) lockCableEndStripFrontier(p, end);
    lock = end === 'start' ? p.startStripFrontierLock : p.stripFrontierLock;
    if (!lock) return false;
    var fs = ensureCableEndStrip(p, end);
    var maxLen = maxCableEndStripLenPx(p, end);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    fs.jacketTo = j;
    fs.bareTo = j;
    fs.peel = 0;
    fs.peelLayer = null;
    setCableEndStripStage(p, end, 2);
    lock.jacketTo = j;
    lock.bareTo = j;
    syncCablePrepState(p);
    return true;
  }

  function pinJacketBoundaryToWorldXForEnd(p, end, targetX) {
    if (!p || targetX == null || !isFinite(targetX)) return;
    end = resolveCableEnd(p, end);
    var fs = ensureCableEndStrip(p, end);
    var maxLen = isCable(p) ? maxCableEndStripLenPx(p, end) : maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen <= 0) return;
    var lo = STRIP_TIP_EPS;
    var hi = maxLen;
    var iter;
    for (iter = 0; iter < 28; iter++) {
      var mid = (lo + hi) * 0.5;
      fs.jacketTo = mid;
      fs.bareTo = mid;
      var boundary = getJacketBoundaryWorld(p, end);
      if (!boundary || !isFinite(boundary.x)) break;
      if (Math.abs(boundary.x - targetX) <= RULER_WALL_EPS) {
        fs.bareTo = mid;
        return;
      }
      if (boundary.x > targetX) lo = mid;
      else hi = mid;
    }
    fs.bareTo = fs.jacketTo;
  }

  function enforceRulerWallForEnd(p, rulerStopX, end) {
    if (!p || rulerStopX == null) return;
    end = resolveCableEnd(p, end);
    var i;
    for (i = 0; i < 12; i++) {
      var boundary = getJacketBoundaryWorld(p, end);
      if (!boundary || boundary.x <= rulerStopX + RULER_WALL_EPS) return;
      translateCableEndGeometry(p, end, rulerStopX - boundary.x, 0);
    }
  }

  function enforceCleavedJacketWallForEnd(p, end) {
    end = resolveCableEnd(p, end);
    if (!isCable(p)) {
      enforceCleavedJacketWall(p);
      return;
    }
    if (!isCableEndCleaved(p, end)) return;
    var lock = end === 'start' ? p.startCleavedStripLock : p.cleavedStripLock;
    if (!lock) return;
    if (!cableEndIsSnappedToCleaver(p, end)) return;
    var fs = ensureCableEndStrip(p, end);
    var wallX = lock.rulerStopX != null ? lock.rulerStopX : lock.jacketBoundaryX;
    if (wallX == null) return;
    if (lock.jacketBoundaryX != null) {
      pinJacketBoundaryToWorldXForEnd(p, end, lock.jacketBoundaryX);
    } else {
      fs.jacketTo = lock.jacketTo;
      fs.bareTo = lock.bareTo;
    }
    enforceRulerWallForEnd(p, wallX, end);
    lock.jacketTo = fs.jacketTo;
    lock.bareTo = fs.jacketTo;
    var boundary = getJacketBoundaryWorld(p, end);
    if (boundary) lock.jacketBoundaryX = boundary.x;
    syncCablePrepState(p);
  }

  function cleaverCableEndsForProbe(p, cleaverId, wx, wy) {
    if (!isCable(p)) return ['end'];
    if (cleaverId) {
      var docked = [];
      if (p.startIsSnappedToCleaver && p.startSnappedCleaverId === cleaverId) docked.push('start');
      if (p.isSnappedToCleaver && p.snappedCleaverId === cleaverId) docked.push('end');
      if (docked.length) return docked;
    }
    return [nearestCableEndAtWorld(p, wx, wy)];
  }

  /** Which end (if any) is seated in this cleaver groove. */
  function resolveCleaverMountedEnd(p, cleaverId) {
    if (!p || !cleaverId) return null;
    if (isCable(p)) {
      if (p.startIsSnappedToCleaver && p.startSnappedCleaverId === cleaverId) return 'start';
      if (p.isSnappedToCleaver && p.snappedCleaverId === cleaverId) return 'end';
      return null;
    }
    if (p.isSnappedToCleaver && p.snappedCleaverId === cleaverId) return 'end';
    return null;
  }

  function findDockedCleaverCleaveTarget(cleaverId) {
    if (!cleaverId) return null;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var end = resolveCleaverMountedEnd(p, cleaverId);
      if (!end) continue;
      if (isCableEndCleaved(p, end)) continue;
      if (getCableEndStripStage(p, end) < 2) continue;
      return { p: p, end: end, id: fiberTargetId(p, end) };
    }
    return null;
  }

  function restoreCleavedStripLock(p) {
    if (!p || !(p.isCleaved || p.cleaved)) return;
    ensureFiberStrip(p);
    if (!p.cleavedStripLock) {
      var boundary = getJacketBoundaryWorld(p);
      p.cleavedStripLock = {
        jacketTo: p.fiberStrip.jacketTo || 0,
        bareTo: p.fiberStrip.bareTo || 0,
        jacketBoundaryX: boundary ? boundary.x : null,
        rulerStopX: p.cleaverSlotAnchorX != null ? p.cleaverSlotAnchorX : null,
      };
    }
    var lock = p.cleavedStripLock;
    var maxLen = maxStripLenPx(p);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    p.fiberStrip.jacketTo = j;
    p.fiberStrip.bareTo = j;
    p.fiberStrip.peel = 0;
    p.fiberStrip.peelLayer = null;
    lock.jacketTo = j;
    lock.bareTo = j;
    syncStripStageFromFiberStrip(p);
    enforceFullStripBareFrontier(p);
    lockPermanentStripFrontier(p);
  }

  /** Persist stage-2 strip arc-lengths — survives cleaver undock and free drag. */
  function lockPermanentStripFrontier(p) {
    if (!p) return;
    ensureFiberStrip(p);
    if (!isFullyStrippedPigtail(p) && (Number(p.stripStage) || 0) < 2) return;
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    p.stripFrontierLock = {
      jacketTo: fs.jacketTo || 0,
      bareTo: fs.bareTo || 0,
      stripStage: 2,
    };
  }

  function restorePermanentStripFrontier(p) {
    if (!p) return false;
    if (p.isCleaved || p.cleaved) {
      restoreCleavedStripLock(p);
      lockPermanentStripFrontier(p);
      return true;
    }
    if ((Number(p.stripStage) || 0) >= 2 && !p.stripFrontierLock) {
      lockPermanentStripFrontier(p);
    }
    if (!p.stripFrontierLock) return false;
    ensureFiberStrip(p);
    var lock = p.stripFrontierLock;
    var fs = p.fiberStrip;
    var maxLen = maxStripLenPx(p);
    var j = lock.jacketTo;
    if (!isFinite(j) || j < STRIP_TIP_EPS) j = STRIP_TIP_EPS;
    if (isFinite(maxLen) && maxLen >= 0 && j > maxLen) j = maxLen;
    fs.jacketTo = j;
    fs.bareTo = j;
    fs.peel = 0;
    fs.peelLayer = null;
    p.stripStage = 2;
    p.stripLengthPx = j;
    lock.jacketTo = j;
    lock.bareTo = j;
    enforceFullStripBareFrontier(p);
    return true;
  }

  /** Binary-search jacketTo so the yellow jacket frontier lands on a fixed world X. */
  function pinJacketBoundaryToWorldX(p, targetX) {
    if (!p || targetX == null || !isFinite(targetX)) return;
    ensureFiberStrip(p);
    var maxLen = maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen <= 0) return;
    var lo = STRIP_TIP_EPS;
    var hi = maxLen;
    var iter;
    for (iter = 0; iter < 28; iter++) {
      var mid = (lo + hi) * 0.5;
      p.fiberStrip.jacketTo = mid;
      p.fiberStrip.bareTo = mid;
      var boundary = getJacketBoundaryWorld(p);
      if (!boundary || !isFinite(boundary.x)) break;
      if (Math.abs(boundary.x - targetX) <= RULER_WALL_EPS) {
        p.fiberStrip.bareTo = mid;
        return;
      }
      if (boundary.x > targetX) lo = mid;
      else hi = mid;
    }
    p.fiberStrip.bareTo = p.fiberStrip.jacketTo;
  }

  function captureCleaveStripAnchor(p, cleaverId, end) {
    end = isCable(p) ? resolveCableEnd(p, end) : 'end';
    var fs = ensureCableEndStrip(p, end);
    var boundary = getJacketBoundaryWorld(p, end);
    var rulerStopX = end === 'start' ? p.startCleaverSlotAnchorX : p.cleaverSlotAnchorX;
    if (rulerStopX == null && cleaverId) {
      var slot = getCleaverSlotGeometry(cleaverId);
      if (slot && slot.rulerStopX != null) rulerStopX = slot.rulerStopX;
    }
    if (rulerStopX == null && boundary) rulerStopX = boundary.x;
    return {
      end: end,
      preJacketTo: fs.jacketTo || 0,
      preBareTo: fs.bareTo || 0,
      jacketBoundaryX: boundary ? boundary.x : null,
      rulerStopX: rulerStopX,
    };
  }

  /** Keep yellow jacket on ruler wall while docked; preserve arc-lengths when free. */
  function enforceCleavedJacketWall(p) {
    if (!p || !(p.isCleaved || p.cleaved) || !p.cleavedStripLock) return;
    if (!p.isSnappedToCleaver) {
      enforceFullStripBareFrontier(p);
      return;
    }
    var lock = p.cleavedStripLock;
    var wallX = lock.rulerStopX != null ? lock.rulerStopX : lock.jacketBoundaryX;
    if (wallX == null) return;
    if (lock.jacketBoundaryX != null) {
      pinJacketBoundaryToWorldX(p, lock.jacketBoundaryX);
    } else {
      p.fiberStrip.jacketTo = lock.jacketTo;
      p.fiberStrip.bareTo = lock.bareTo;
    }
    enforceRulerWall(p, wallX);
    lock.jacketTo = p.fiberStrip.jacketTo;
    lock.bareTo = p.fiberStrip.jacketTo;
    var boundary = getJacketBoundaryWorld(p);
    if (boundary) lock.jacketBoundaryX = boundary.x;
    enforceFullStripBareFrontier(p);
  }

  function lockCleavedStripGeometry(p, bareLenPx, opts) {
    opts = opts || {};
    if (!p) return;
    var end = isCable(p) ? resolveCableEnd(p, opts.end) : 'end';
    var fs = ensureCableEndStrip(p, end);
    var bareLen = typeof bareLenPx === 'number' ? bareLenPx : getBareGlassLengthAfterCutPx();
    bareLen = Math.max(CLEAVE_MIN_CUT_PX, bareLen);
    var maxLen = isCable(p) ? maxCableEndStripLenPx(p, end) : maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen < 0) maxLen = 0;

    var jacketTo;
    if (typeof opts.preJacketTo === 'number') {
      var removed = typeof opts.removedFromTip === 'number' ? opts.removedFromTip : 0;
      jacketTo = Math.max(bareLen, opts.preJacketTo - removed);
    } else {
      jacketTo = fs.jacketTo || 0;
    }
    jacketTo = Math.min(jacketTo, maxLen);
    fs.jacketTo = jacketTo;
    fs.bareTo = jacketTo;
    fs.peel = 0;
    fs.peelLayer = null;

    var lock = {
      jacketTo: jacketTo,
      bareTo: jacketTo,
    };
    if (opts.jacketBoundaryX != null) lock.jacketBoundaryX = opts.jacketBoundaryX;
    if (opts.rulerStopX != null) lock.rulerStopX = opts.rulerStopX;
    if (end === 'start') p.startCleavedStripLock = lock;
    else p.cleavedStripLock = lock;

    if (isCable(p)) {
      syncCablePrepState(p);
      setCableEndStripStage(p, end, 2);
    } else {
      enforceFullStripBareFrontier(p);
      syncStripStageFromFiberStrip(p);
      lockPermanentStripFrontier(p);
    }
  }

  var STRIP_TIP_EPS = 0.05;
  /** When bareTo is within this many px of jacketTo, treat buffer as fully stripped. */
  var STRIP_BUFFER_COMPLETE_PX = 1;

  function isBareStripComplete(fs) {
    if (!fs) return false;
    var j = fs.jacketTo || 0;
    var b = fs.bareTo || 0;
    return j > STRIP_TIP_EPS && b >= j - STRIP_BUFFER_COMPLETE_PX;
  }

  function snapBareToJacket(fs) {
    if (!fs) return;
    fs.bareTo = fs.jacketTo || 0;
  }

  function snapBareIfComplete(fs) {
    if (isBareStripComplete(fs)) {
      snapBareToJacket(fs);
      return true;
    }
    return false;
  }

  /**
   * Keep strip frontiers valid against the live fiber polyline (tip-anchored arc-length).
   * Call whenever geometry changes — extend, route, or cleave.
   */
  function clampStripFrontiersToPath(p, end) {
    if (!p) return;
    if (isCable(p)) {
      var ends = end ? [resolveCableEnd(p, end)] : ['start', 'end'];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var cableEnd = ends[ei];
        if (isCableEndCleaved(p, cableEnd)) continue;
        var fs = ensureCableEndStrip(p, cableEnd);
        var maxLen = maxCableEndStripLenPx(p, cableEnd);
        if (!isFinite(maxLen) || maxLen < 0) maxLen = 0;
        var prep = cableEndPrepState(p, cableEnd);
        if (prep.strippedLengthPx > maxLen) prep.strippedLengthPx = maxLen;
        if (fs.jacketTo > maxLen) fs.jacketTo = maxLen;
        if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
        if (fs.bareTo > maxLen) fs.bareTo = maxLen;
        syncFiberStripFromStrippedLength(p, cableEnd);
      }
      syncCablePrepState(p);
      return;
    }
    ensureFiberStrip(p);
    if (p.isCleaved || p.cleaved || (Number(p.stripStage) || 0) >= 2 || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
      return;
    }
    var fs = p.fiberStrip;
    var maxLen = maxStripLenPx(p);
    if (!isFinite(maxLen) || maxLen < 0) maxLen = 0;
    ensurePigtailPrepState(p);
    if (p.prepState.strippedLengthPx > maxLen) p.prepState.strippedLengthPx = maxLen;
    if (fs.jacketTo > maxLen) fs.jacketTo = maxLen;
    if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    if (fs.bareTo > maxLen) fs.bareTo = maxLen;
    syncFiberStripFromStrippedLength(p, 'end');
    syncStripStageFromFiberStrip(p);
  }

  /** Reconcile locked render length with measured sleeve-path arc length. */
  function syncPigtailFiberLength(p) {
    if (!p) return;
    var pts = fiberSleevePathPoints(p);
    var measured = polylineLength(pts);
    if (isFinite(measured) && measured > 0) {
      p.fixedLength = Math.max(40, measured);
    }
    clampStripFrontiersToPath(p);
  }

  function syncStripStageFromFiberStrip(p) {
    if (!p) return;
    ensureFiberStrip(p);
    var fs = p.fiberStrip;
    if (p.isCleaved || p.cleaved) {
      snapBareToJacket(fs);
      p.stripStage = 2;
      p.stripLengthPx = fs.jacketTo || 0;
      p.stripPeel = fs.peel || 0;
      return;
    }
    if (p.stripFrontierLock && (Number(p.stripStage) || 0) >= 2) {
      snapBareToJacket(fs);
      p.stripStage = 2;
      p.stripLengthPx = fs.jacketTo || 0;
      p.stripPeel = fs.peel || 0;
      return;
    }
    var j = fs.jacketTo || 0;
    var b = fs.bareTo || 0;
    if (j < STRIP_TIP_EPS) {
      p.stripStage = 0;
    } else if (b >= j - STRIP_BUFFER_COMPLETE_PX) {
      p.stripStage = 2;
      snapBareToJacket(fs);
      lockPermanentStripFrontier(p);
    } else {
      p.stripStage = 1;
    }
    if ((Number(p.stripStage) || 0) >= 1) p.isStripped = true;
    p.stripLengthPx = j;
    p.stripPeel = fs.peel || 0;
    ensurePigtailPrepState(p);
    if (j > (p.prepState.strippedLengthPx || 0)) {
      p.prepState.strippedLengthPx = j;
      p.prepState.stripped = j > STRIP_TIP_EPS;
    }
  }

  /** Committed jacket strip length from tip (ignores ephemeral peel animation). */
  function stripCommittedPx(p) {
    if (!p) return 0;
    ensureFiberStrip(p);
    var n = Number(p.fiberStrip.jacketTo);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** How many px from the cleaved tip have jacket removed. */
  function stripExposedFromTipPx(p) {
    return stripCommittedPx(p);
  }

  function stripBareFromTipPx(p) {
    if (!p) return 0;
    ensureFiberStrip(p);
    var n = Number(p.fiberStrip.bareTo);
    return isFinite(n) && n > 0 ? n : 0;
  }

  /** Visual kind for the tip-side segment when only jacket is partially removed. */
  function stripExposedKind(p) {
    ensureFiberStrip(p);
    if (isFullyStrippedPigtail(p)) return 'bare';
    var fs = p.fiberStrip;
    if (isBareStripComplete(fs)) return 'bare';
    if ((fs.jacketTo || 0) > 0.5) return 'buffer';
    if ((fs.peel || 0) > 0.02) return 'buffer';
    return null;
  }

  function stripHitFromProj(p, pts, proj, stage, layer, thr, end) {
    end = end ? cableEndFromToken(end) : 'end';
    var fs = ensureCableEndStrip(p, end);
    var dirs = peelDirsFromPath(pts);
    return {
      id: fiberTargetId(p, end),
      end: end,
      stage: stage,
      layer: layer,
      x: proj.x,
      y: proj.y,
      rot: proj.rot,
      peelUx: dirs.peelUx,
      peelUy: dirs.peelUy,
      perpDist: proj.perpDist,
      along: proj.dist,
      jacketTo: fs.jacketTo || 0,
      bareTo: fs.bareTo || 0,
      jacketColorHex: getJacketColorHex(p),
    };
  }

  function svgPathFromPoints(pts, opts) {
    opts = opts || {};
    if (!pts || !pts.length) return '';
    if (opts.fillet) {
      return filletOrthoSvg(pts, opts.filletRadius || ORTHO_FILLET_R);
    }
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < pts.length; i++) {
      d += ' L ' + pts[i].x + ' ' + pts[i].y;
    }
    return d;
  }

  /** Dense polyline for arc-length / strip math (filleted snake corners). */
  function fiberRenderPathPointsDense(p) {
    var pts = fiberRenderPathPoints(p);
    if (usesOrthoRoute(p)) {
      return sampleFilletOrthoPoints(collapseOrthoPts(pts), ORTHO_FILLET_R);
    }
    return pts;
  }

  /** SVG d= string with smooth quadratic fillets in snake mode. */
  function fiberSvgPathFromRenderPoints(p, pts) {
    if (!pts || !pts.length) return '';
    if (usesOrthoRoute(p)) {
      return filletOrthoSvg(collapseOrthoPts(pts), ORTHO_FILLET_R);
    }
    return svgPathFromPoints(pts);
  }

  /** Slice a polyline between two arc-length distances [d0, d1]. */
  function slicePolylineByDistance(pts, d0, d1) {
    if (!pts || pts.length < 2) return pts ? pts.slice() : [];
    var total = polylineLength(pts);
    if (total < 0.01) return [{ x: pts[0].x, y: pts[0].y }];
    var a = Math.max(0, Math.min(total, d0));
    var b = Math.max(0, Math.min(total, d1));
    if (b < a) {
      var tmp = a;
      a = b;
      b = tmp;
    }
    if (b - a < 0.25) {
      var mid = pointAtPathDistance(pts, (a + b) / 2);
      return [{ x: mid.x, y: mid.y }, { x: mid.x, y: mid.y }];
    }
    var start = pointAtPathDistance(pts, a);
    var end = pointAtPathDistance(pts, b);
    var out = [{ x: start.x, y: start.y }];
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segLen = dist2(ax, ay, bx, by);
      var next = acc + segLen;
      if (next > a + 0.01 && acc < b - 0.01) {
        if (acc >= a - 0.01 && next <= b + 0.01) {
          pushSleevePathPt(out, { x: bx, y: by });
        } else if (acc < a && next > a && next <= b) {
          pushSleevePathPt(out, { x: bx, y: by });
        } else if (acc >= a && acc < b && next > b) {
          /* end handled below */
        } else if (acc < a && next > b) {
          /* segment spans both ends — only endpoints */
        }
      }
      acc = next;
    }
    pushSleevePathPt(out, { x: end.x, y: end.y });
    if (out.length < 2) out.push({ x: end.x, y: end.y });
    return out;
  }

  /**
   * Full render polyline connector → tip (same geometry as fiberPath).
   * Snake mode returns corner vertices; SVG fillets are applied at draw time.
   */
  function fiberRenderPathPoints(p) {
    if (isCable(p)) {
      var tipA = { x: p.ax, y: p.ay };
      var tipB = { x: p.bx, y: p.by };
      ensurePathHistory(p);
      if (usesOrthoRoute(p)) {
        return orthoPolyline(p);
      }
      var cablePts = [{ x: tipA.x, y: tipA.y }];
      var cL = resolvePigtailRenderLength(p, tipA, tipB);
      var cMid = samplePigtailCatenary(tipA, tipB, cL, PIGTAIL_CATENARY_SAMPLES);
      var cj;
      for (cj = 1; cj < cMid.length; cj++) {
        pushSleevePathPt(cablePts, cMid[cj]);
      }
      return cablePts;
    }
    var tipA = bootAnchor(p);
    var p0 = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };
    ensurePathHistory(p);
    var pts = [{ x: tipA.x, y: tipA.y }, { x: p0.x, y: p0.y }];
    if (usesOrthoRoute(p)) {
      var ortho = orthoPolyline(p);
      var i;
      for (i = 0; i < ortho.length; i++) {
        pushSleevePathPt(pts, ortho[i]);
      }
      pushSleevePathPt(pts, tipB);
      return collapseOrthoPts(pts);
    }
    var L = resolvePigtailRenderLength(p, p0, tipB);
    var mid = samplePigtailCatenary(p0, tipB, L, PIGTAIL_CATENARY_SAMPLES);
    var j;
    for (j = 1; j < mid.length; j++) {
      pushSleevePathPt(pts, mid[j]);
    }
    return pts;
  }

  /** Map tip-anchored sleeve arc-length to the render polyline (includes boot segment). */
  function stripArcOnRenderPath(p, sleeveDistFromTip) {
    var d = Number(sleeveDistFromTip);
    if (!isFinite(d) || d <= 0) return 0;
    var sleevePts = fiberSleevePathPoints(p);
    var renderPts = fiberRenderPathPointsDense(p);
    var sleeveLen = polylineLength(sleevePts);
    var renderLen = polylineLength(renderPts);
    if (sleeveLen < STRIP_TIP_EPS) return 0;
    return Math.min(renderLen, d * (renderLen / sleeveLen));
  }

  /**
   * Render-path px length of exposed bare glass — identical math to the free-state
   * bare segment in buildPigtailFiberSvg (tip-anchored bareTo / jacketTo).
   */
  function getBareGlassDrawLengthPx(p) {
    if (!p) return 0;
    if (isCable(p)) {
      return cableEndRenderDistPx(p, p.activeCableEnd || 'end', 'bare');
    }
    return endRenderStripDistPx(p, 'end', 'bare');
  }

  function cleanedBareClass(p) {
    return p && p.isCleaned ? ' is-fiber-cleaned' : '';
  }

  function getPigtailBufferStrokeColor(p) {
    if (p && typeof p.bufferColor === 'string' && p.bufferColor) return p.bufferColor;
    if (p && p.fiberStrip && typeof p.fiberStrip.bufferColor === 'string' && p.fiberStrip.bufferColor) {
      return p.fiberStrip.bufferColor;
    }
    return PIGTAIL_BUFFER_STROKE_COLOR;
  }

  function shouldShowPigtailResidue(p) {
    if (!p || p.isCleaned) return false;
    return isFullyStrippedPigtail(p) || !!(p.isCleaved || p.cleaved);
  }

  function shouldShowCableEndResidue(p, end) {
    if (!isCable(p)) return shouldShowPigtailResidue(p);
    end = cableEndFromToken(end);
    syncCablePrepState(p);
    var prep = cableEndPrepState(p, end);
    if (!prep.stripped || prep.cleaned) return false;
    var fs = ensureCableEndStrip(p, end);
    if (prep.cleaved || isCableEndCleaved(p, end)) return true;
    if (getCableEndStripStage(p, end) >= 2 || isBareStripComplete(fs)) return true;
    return (fs.bareTo || 0) > STRIP_TIP_EPS;
  }

  function buildPigtailResiduePathSvg(p, pathD) {
    if (!shouldShowPigtailResidue(p) || !pathD) return '';
    return (
      '<path class="lab-pigtail-residue" data-pt-residue="' + p.id + '" data-pt-fiber="' + p.id +
      '" d="' + pathD + '" fill="none" stroke="' + getPigtailBufferStrokeColor(p) + '" />'
    );
  }

  function buildCableEndResiduePathSvg(p, end, pathD) {
    if (!shouldShowCableEndResidue(p, end) || !pathD) return '';
    var targetId = fiberTargetId(p, end);
    return (
      '<path class="lab-pigtail-residue" data-pt-residue="' + targetId + '" data-pt-fiber="' + p.id +
      '" data-pt-fiber-end="' + cableEndFromToken(end) + '" d="' + pathD +
      '" fill="none" stroke="' + getPigtailBufferStrokeColor(p) + '" />'
    );
  }

  function buildCableEndStripSvg(p, end, densePts, total, sel) {
    end = cableEndFromToken(end);
    syncCablePrepState(p);
    var prep = cableEndPrepState(p, end);
    var fs = ensureCableEndStrip(p, end);
    var jacketTo = Math.max(0, fs.jacketTo || 0);
    var bareTo = Math.max(0, fs.bareTo || 0);
    var fullyStripped = prep.stripped && (getCableEndStripStage(p, end) >= 2 || prep.cleaved);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    if (bareComplete) bareTo = jacketTo;
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var strippedId = fiberTargetId(p, end);
    var cleaved = prep.cleaved || isCableEndCleaved(p, end);
    var splicerCls = cableEndSnappedToSplicer(p, end) ? ' is-splicer-terminated' : '';
    var html = '';

    function peelStyle(layerName) {
      if (peel <= 0.02 || peelLayer !== layerName) return '';
      return ' style="--strip-peel:' + peel.toFixed(3) + ';"';
    }
    function peelClass(layerName) {
      return peel > 0.02 && peelLayer === layerName ? ' is-strip-peeling' : '';
    }
    function segPath(d0, d1) {
      var segPts = slicePolylineByDistance(densePts, d0, d1);
      if (usesOrthoRoute(p) && segPts.length >= 2) {
        return filletOrthoSvg(collapseOrthoPts(segPts), ORTHO_FILLET_R);
      }
      return svgPathFromPoints(segPts);
    }

    var jacketRender = cableEndRenderDistPx(p, end, 'jacket');
    var bareRender = cableEndRenderDistPx(p, end, 'bare');

    if (end === 'start') {
      var dJacketEnd = Math.min(total, jacketRender);
      var dBareEnd = Math.min(total, bareRender);
      if (dJacketEnd > STRIP_TIP_EPS || dBareEnd > STRIP_TIP_EPS) {
        var tipBareStart = fullyStripped || bareComplete ||
          (bareTo >= jacketTo - STRIP_BUFFER_COMPLETE_PX && jacketTo > STRIP_TIP_EPS);
        if (tipBareStart) {
          var startBareFullD = segPath(0, Math.max(dBareEnd, dJacketEnd));
          html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
            (cleaved ? ' lab-pigtail-fiber--cleaved' : '') + peelClass('bare') + splicerCls +
            cleanedBareClassForEnd(p, 'start') +
            '" data-pt-fiber-stripped="' + strippedId + '" data-pt-fiber-end="start" data-pt-fiber-seg="bare" d="' +
            startBareFullD + '" fill="none"' + peelStyle('bare') + ' />' +
            buildCableEndResiduePathSvg(p, 'start', startBareFullD);
        } else if (dBareEnd > STRIP_TIP_EPS) {
          var startBarePartialD = segPath(0, dBareEnd);
          html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
            (cleaved ? ' lab-pigtail-fiber--cleaved' : '') + peelClass('bare') + splicerCls +
            cleanedBareClassForEnd(p, 'start') +
            '" data-pt-fiber-stripped="' + strippedId + '" data-pt-fiber-end="start" data-pt-fiber-seg="bare" d="' +
            startBarePartialD + '" fill="none"' + peelStyle('bare') + ' />' +
            buildCableEndResiduePathSvg(p, 'start', startBarePartialD);
          html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' + peelClass('buffer') +
            '" data-pt-fiber="' + p.id + '" data-pt-fiber-end="start" data-pt-fiber-seg="buffer" d="' +
            segPath(dBareEnd, dJacketEnd) + '" fill="none"' + peelStyle('buffer') + ' />';
        } else if (dJacketEnd > STRIP_TIP_EPS) {
          html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' + peelClass('buffer') +
            '" data-pt-fiber="' + p.id + '" data-pt-fiber-end="start" data-pt-fiber-seg="buffer" d="' +
            segPath(0, dJacketEnd) + '" fill="none"' + peelStyle('buffer') + ' />';
        }
      } else if (!fullyStripped && !bareComplete && jacketTo <= STRIP_TIP_EPS) {
        var tipCap = Math.min(22, total);
        html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' + sel +
          '" data-pt-fiber="' + p.id + '" data-pt-fiber-end="start" data-pt-fiber-seg="buffer" d="' +
          segPath(0, tipCap) + '" fill="none" />';
      }
      return { html: html, jacketEnd: dJacketEnd };
    }

    if (jacketRender > STRIP_TIP_EPS && total > jacketRender + STRIP_TIP_EPS) {
      var dJacketEndB = Math.max(0, total - jacketRender);
      var dBareEndB = Math.max(dJacketEndB, total - bareRender);
      var tipBareB = fullyStripped || bareComplete ||
        (bareRender >= jacketRender - STRIP_BUFFER_COMPLETE_PX && jacketRender > STRIP_TIP_EPS);
      var tipPathDB = segPath(dJacketEndB, total);
      if (tipBareB) {
        html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
          (cleaved ? ' lab-pigtail-fiber--cleaved' : '') + peelClass('bare') + splicerCls +
          cleanedBareClassForEnd(p, 'end') +
          '" data-pt-fiber-stripped="' + strippedId + '" data-pt-fiber-end="end" data-pt-fiber-seg="bare" d="' +
          tipPathDB + '" fill="none"' + peelStyle('bare') + ' />' +
          buildCableEndResiduePathSvg(p, 'end', tipPathDB);
      } else {
        html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' + peelClass('buffer') +
          '" data-pt-fiber="' + p.id + '" data-pt-fiber-end="end" data-pt-fiber-seg="buffer" d="' +
          segPath(dJacketEndB, dBareEndB) + '" fill="none"' + peelStyle('buffer') + ' />';
        html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
          (cleaved ? ' lab-pigtail-fiber--cleaved' : '') + peelClass('bare') + splicerCls +
          cleanedBareClassForEnd(p, 'end') +
          '" data-pt-fiber-stripped="' + strippedId + '" data-pt-fiber-end="end" data-pt-fiber-seg="bare" d="' +
          tipPathDB + '" fill="none"' + peelStyle('bare') + ' />' +
          buildCableEndResiduePathSvg(p, 'end', tipPathDB);
      }
      return { html: html, jacketStart: dJacketEndB };
    }
    return { html: html, jacketStart: total };
  }

  function buildCableFiberSvg(p, opts) {
    opts = opts || {};
    var densePts = fiberRenderPathPointsDense(p);
    var fullPts = fiberRenderPathPoints(p);
    var fullPath = fiberSvgPathFromRenderPoints(p, fullPts) || fiberPath(p);
    var total = polylineLength(densePts);
    var sel = selection.id === p.id ? ' is-selected' : '';
    var startFused = isMemberEndFused(p, 'start');
    var endFused = isMemberEndFused(p, 'end');
    var startSeg = buildCableEndStripSvg(p, 'start', densePts, total, sel);
    var endSeg = buildCableEndStripSvg(p, 'end', densePts, total, sel);
    var midStart = Math.max(startSeg.jacketEnd || 0, 0);
    var midEnd = Math.min(endSeg.jacketStart != null ? endSeg.jacketStart : total, total);
    var fusedBareStart = 0;
    var fusedBareEnd = 0;
    if (startFused) {
      fusedBareStart = Math.max(
        cableEndRenderDistPx(p, 'start', 'bare'),
        getSplicerExposedBareLengthPxForEnd(p, 'start')
      );
      midStart = Math.max(0, Math.min(total, fusedBareStart + CABLE_FUSION_JACKET_STUB_PX));
    }
    if (endFused) {
      fusedBareEnd = Math.max(
        cableEndRenderDistPx(p, 'end', 'bare'),
        getSplicerExposedBareLengthPxForEnd(p, 'end')
      );
      midEnd = Math.max(0, Math.min(total, total - fusedBareEnd - CABLE_FUSION_JACKET_STUB_PX));
    }
    var html =
      '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + fullPath +
      '" fill="none" stroke="transparent" />';
    if (!startFused) {
      html += startSeg.html;
    }
    var jacketStrokeStyle = jacketStrokeStyleAttr(p);
    function appendCableMidJacketPath(pathD) {
      if (!pathD) return;
      html += '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' + sel +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="cable-mid-jacket" d="' + pathD +
        '" fill="none"' + jacketStrokeStyle + ' />';
    }
    if (midEnd <= midStart) {
      midEnd = Math.min(total, midStart + 0.1);
    }
    if (midEnd > midStart + STRIP_TIP_EPS) {
      var midPts = slicePolylineByDistance(densePts, midStart, midEnd);
      appendCableMidJacketPath(fiberSvgPathFromRenderPoints(p, midPts));
    } else if (midStart <= STRIP_TIP_EPS && midEnd >= total - STRIP_TIP_EPS) {
      appendCableMidJacketPath(fullPath);
    } else if (startFused || endFused) {
      var bodyStart = startFused
        ? Math.max(0, Math.min(total, fusedBareStart + CABLE_FUSION_JACKET_STUB_PX))
        : midStart;
      var bodyEnd = endFused
        ? Math.max(0, Math.min(total, total - fusedBareEnd - CABLE_FUSION_JACKET_STUB_PX))
        : midEnd;
      if (bodyEnd > bodyStart + STRIP_TIP_EPS) {
        var bodyPts = slicePolylineByDistance(densePts, bodyStart, bodyEnd);
        appendCableMidJacketPath(fiberSvgPathFromRenderPoints(p, bodyPts));
      }
    }
    if (!endFused) {
      html += endSeg.html;
    }
    html += '<path class="lab-pigtail-laser-core" data-pt-laser="' + p.id + '" d="' + fullPath + '" fill="none" />';
    html += '<path class="lab-pigtail-laser-core" data-pt-laser="' + p.id + ':start" d="' +
      svgPathFromPoints(slicePolylineByDistance(densePts, 0, Math.min(24, total))) + '" fill="none" />';
    return html;
  }

  function buildPigtailFiberSvg(p, opts) {
    opts = opts || {};
    if (isCable(p)) return buildCableFiberSvg(p, opts);
    var fullPts = fiberRenderPathPoints(p);
    var densePts = fiberRenderPathPointsDense(p);
    var fullPath = fiberSvgPathFromRenderPoints(p, fullPts) || fiberPath(p);
    var bad = p.connector.mismatch;
    var sel = selection.id === p.id ? ' is-selected' : '';
    var splicerDocked = !!p.isSnappedToSplicer;
    var splicerPort = !!opts.splicerPort;
    if (splicerDocked && !splicerPort) {
      return (
        '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + fullPath +
        '" fill="none" stroke="transparent" />'
      );
    }
    ensureFiberStrip(p);
    enforceFullStripBareFrontier(p);
    var fs = p.fiberStrip;
    var jacketTo = Math.max(0, fs.jacketTo || 0);
    var bareTo = Math.max(0, fs.bareTo || 0);
    var fullyStripped = isFullyStrippedPigtail(p);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    if (bareComplete) {
      bareTo = jacketTo;
    }
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var total = polylineLength(densePts);
    var html =
      '<path class="lab-pigtail-fiber-hit" data-pt-drag="' + p.id + '" d="' + fullPath +
      '" fill="none" stroke="transparent" />';

    var splicerCls = splicerDocked && splicerPort ? ' is-splicer-terminated' : '';

    function peelStyle(layerName) {
      if (peel <= 0.02 || peelLayer !== layerName) return '';
      return ' style="--strip-peel:' + peel.toFixed(3) + ';"';
    }

    function peelClass(layerName) {
      return peel > 0.02 && peelLayer === layerName ? ' is-strip-peeling' : '';
    }

    function jacketStyleAttr(layerName) {
      return jacketPathStyleAttr(p, layerName, peel, peelLayer);
    }

    function segPathFromDenseSlice(d0, d1) {
      var segPts = slicePolylineByDistance(densePts, d0, d1);
      if (usesOrthoRoute(p) && segPts.length >= 2) {
        return filletOrthoSvg(collapseOrthoPts(segPts), ORTHO_FILLET_R);
      }
      return svgPathFromPoints(segPts);
    }

    var splicerSlot = null;
    if ((splicerDocked && splicerPort && p.snappedSplicerId && p.snappedSplicerSide) ||
        isPigtailFused(p)) {
      if (p.snappedSplicerId && p.snappedSplicerSide) {
        splicerSlot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
      } else if (isPigtailFused(p)) {
        splicerSlot = getSplicerGrooveSlot(p.splicerWeldMachineId, p.splicerFusedSide, { forTracking: true });
      }
    }
    var splicerClampRender = !!(
      !isPigtailFused(p) &&
      splicerDocked &&
      splicerPort &&
      splicerSlot &&
      p.splicerInnerEdgeX != null
    );

    if (isPigtailFused(p)) {
      /* Jacket + glass render in the unified fused-assembly group — hit path only here. */
    } else if (splicerClampRender) {
      var grooveY = splicerSlot.grooveY;
      var innerPt = { x: p.splicerInnerEdgeX, y: grooveY };
      var innerProj = projectOntoFiberStrict(densePts, innerPt.x, innerPt.y);
      var dInner = Math.max(0, Math.min(total, innerProj.dist || 0));
      var bareLenPx = getSplicerExposedBareLengthPx(p);
      var dBareEnd = Math.min(total, dInner + bareLenPx);
      var jacketPts = slicePolylineByDistance(densePts, 0, dInner);
      var barePts = slicePolylineByDistance(densePts, dInner, dBareEnd);
      if (jacketPts.length < 2) jacketPts = slicePolylineByDistance(densePts, 0, Math.max(dInner, 2));
      if (barePts.length < 2) {
        barePts = slicePolylineByDistance(densePts, dInner, Math.max(dBareEnd, dInner + bareLenPx));
      }
      var barePathD = fiberSvgPathFromRenderPoints(p, barePts);
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' +
        fiberSvgPathFromRenderPoints(p, jacketPts) + '" fill="none"' + jacketStyleAttr('jacket') + ' />' +
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
        (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
        (bad ? ' is-mismatch' : '') + peelClass('bare') + splicerCls + cleanedBareClass(p) +
        '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="bare" d="' +
        barePathD + '" fill="none"' + peelStyle('bare') + ' />' +
        buildPigtailResiduePathSvg(p, barePathD);
    } else {
    var jacketRender = endRenderStripDistPx(p, 'end', 'jacket');
    var bareRender = endRenderStripDistPx(p, 'end', 'bare');
    if (jacketRender > STRIP_TIP_EPS && total > jacketRender + STRIP_TIP_EPS) {
      var dJacketEnd = Math.max(0, total - jacketRender);
      var dBareEnd = Math.max(dJacketEnd, total - bareRender);
      var jacketD = segPathFromDenseSlice(0, dJacketEnd);
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' + jacketD +
        '" fill="none"' + jacketStyleAttr('jacket') + ' />';

      var bufferGap = jacketRender - bareRender;
      var bufferSplit = !fullyStripped && !bareComplete &&
        bareRender > STRIP_TIP_EPS &&
        bufferGap >= STRIP_BUFFER_COMPLETE_PX;
      if (bufferSplit) {
        var bufferPts = slicePolylineByDistance(densePts, dJacketEnd, dBareEnd);
        var bufferLen = polylineLength(bufferPts);
        if (bufferLen < STRIP_BUFFER_COMPLETE_PX) {
          bufferSplit = false;
        } else {
          var bufferBareD = segPathFromDenseSlice(dBareEnd, total);
          html +=
            '<path class="lab-pigtail-fiber lab-pigtail-fiber--buffer' +
            (bad ? ' is-mismatch' : '') + peelClass('buffer') +
            '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="buffer" d="' +
            segPathFromDenseSlice(dJacketEnd, dBareEnd) + '" fill="none"' + peelStyle('buffer') + ' />' +
            '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip' +
            (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
            (bad ? ' is-mismatch' : '') + peelClass('bare') + splicerCls + cleanedBareClass(p) +
            '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="bare" d="' +
            bufferBareD + '" fill="none"' + peelStyle('bare') + ' />' +
            buildPigtailResiduePathSvg(p, bufferBareD);
        }
      }
      if (!bufferSplit) {
        var tipBare = fullyStripped || bareComplete ||
          (bareRender >= jacketRender - STRIP_BUFFER_COMPLETE_PX && jacketRender > STRIP_TIP_EPS);
        var tipKind = tipBare ? 'bare' : (stripExposedKind(p) || 'buffer');
        var tipPathD = segPathFromDenseSlice(dJacketEnd, total);
        html +=
          '<path class="lab-pigtail-fiber lab-pigtail-fiber--' + tipKind +
          (tipBare ? ' lab-pigtail-fiber--bare-tip' : '') +
          (p.cleaved || p.isCleaved ? ' lab-pigtail-fiber--cleaved' : '') +
          (bad ? ' is-mismatch' : '') + peelClass(tipBare ? 'bare' : 'buffer') + splicerCls +
          (tipBare ? cleanedBareClass(p) : '') +
          '" data-pt-fiber-stripped="' + p.id + '" data-pt-fiber-seg="' +
          (tipBare ? 'bare' : 'stripped') + '" d="' +
          tipPathD + '" fill="none"' +
          peelStyle(tipBare ? 'bare' : 'buffer') + ' />' +
          (tipBare ? buildPigtailResiduePathSvg(p, tipPathD) : '');
      }
    } else {
      html +=
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
        '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' + fullPath +
        '" fill="none"' + jacketStyleAttr('jacket') + ' />';
    }
    }

    var ghost = ghostPreviewPath(p);
    if (ghost) {
      html +=
        '<path class="lab-pigtail-fiber-ghost" data-pt-ghost="' + p.id +
        '" d="' + ghost + '" fill="none" />';
    }
    if (!isPigtailFused(p)) {
      html +=
        '<path class="lab-pigtail-laser-core" data-pt-laser="' + p.id + '" d="' + fullPath +
        '" fill="none" />';
    }
    return html;
  }

  function setStripGuideLine(guide) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-strip-guide="1"]');
    if (!guide || guide.x1 == null || guide.y1 == null || guide.x2 == null || guide.y2 == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var d =
      'M ' + Number(guide.x1) + ' ' + Number(guide.y1) +
      ' L ' + Number(guide.x2) + ' ' + Number(guide.y2);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('data-pt-strip-guide', '1');
      el.setAttribute('class', 'lab-pigtail-strip-guide');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute('d', d);
  }

  function clearStripGuideLine() {
    setStripGuideLine(null);
  }

  function setCleaverGuideLine(guide, seated) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-cleaver-guide="1"]');
    if (!guide || guide.x1 == null || guide.y1 == null || guide.x2 == null || guide.y2 == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var d =
      'M ' + Number(guide.x1) + ' ' + Number(guide.y1) +
      ' L ' + Number(guide.x2) + ' ' + Number(guide.y2);
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      el.setAttribute('data-pt-cleaver-guide', '1');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute(
      'class',
      'lab-pigtail-cleaver-guide' + (seated ? ' is-seated' : ' is-approach')
    );
    el.setAttribute('d', d);
  }

  function clearCleaverGuideLine() {
    setCleaverGuideLine(null, false);
    setCleaverRulerWallGuide(null);
  }

  /** Vertical guide at ruler stop wall (jacket boundary target). */
  function setCleaverRulerWallGuide(slot, seated) {
    var host = ensureLayer();
    if (!host) return;
    var svg = host.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    var el = svg.querySelector('[data-pt-cleaver-ruler="1"]');
    if (!slot || slot.rulerStopX == null || slot.grooveY == null) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    var y0 = slot.grooveY - 14;
    var y1 = slot.grooveY + 14;
    var d = 'M ' + Number(slot.rulerStopX) + ' ' + y0 + ' L ' + Number(slot.rulerStopX) + ' ' + y1;
    if (!el) {
      el = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      el.setAttribute('data-pt-cleaver-ruler', '1');
      el.setAttribute('fill', 'none');
      svg.appendChild(el);
    }
    el.setAttribute(
      'class',
      'lab-pigtail-cleaver-ruler' + (seated ? ' is-seated' : ' is-approach')
    );
    el.setAttribute('x1', String(slot.rulerStopX));
    el.setAttribute('y1', String(y0));
    el.setAttribute('x2', String(slot.rulerStopX));
    el.setAttribute('y2', String(y1));
    el.setAttribute('d', d);
  }

  function cleaverSlotGuideFromInfo(info) {
    if (!info) return null;
    if (info.slot) return info.slot;
    if (info.slotX1 != null && info.slotX2 != null && info.grooveY != null) {
      return { x1: info.slotX1, y1: info.grooveY, x2: info.slotX2, y2: info.grooveY };
    }
    return info.groove || null;
  }

  function getCleaverSlotGeometry(cleaverId) {
    if (!global.FtthLab || typeof FtthLab.getCleaverRulerStopWorld !== 'function') {
      if (global.FtthLab && typeof FtthLab.getCleaverGrooveWorld === 'function') {
        return FtthLab.getCleaverGrooveWorld(cleaverId);
      }
      return null;
    }
    return FtthLab.getCleaverRulerStopWorld(cleaverId);
  }

  /** World point where yellow jacket meets bare glass (tip-anchored arc-length jacketTo). */
  function getJacketBoundaryWorld(p, end) {
    if (!p) return null;
    end = isCable(p) ? resolveCableEnd(p, end) : 'end';
    var fs = ensureCableEndStrip(p, end);
    var jacketTo = Number(fs.jacketTo) || 0;
    var pts = isCable(p) ? cableStripPathPoints(p, end) : fiberSleevePathPoints(p);
    var tip = cableEndTipWorld(p, end);
    if (!pts || pts.length < 2) {
      return { x: tip.x, y: tip.y };
    }
    if (jacketTo < STRIP_TIP_EPS) {
      return { x: pts[0].x, y: pts[0].y };
    }
    var pt = pointAtPathDistance(pts, jacketTo);
    return { x: pt.x, y: pt.y };
  }

  function translateStartGeometry(p, dx, dy) {
    if (!p || (!dx && !dy)) return;
    p.ax += dx;
    p.ay += dy;
    if (usesOrthoRoute(p)) {
      var hist = ensurePathHistory(p);
      var i;
      for (i = 0; i < hist.length; i++) {
        hist[i].x += dx;
        hist[i].y += dy;
      }
      syncPathAlias(p);
    }
  }

  function translateCableEndGeometry(p, end, dx, dy) {
    end = resolveCableEnd(p, end);
    if (end === 'start') translateStartGeometry(p, dx, dy);
    else translateTailGeometry(p, dx, dy);
  }

  function translateTailGeometry(p, dx, dy) {
    if (!p || (!dx && !dy)) return;
    p.bx += dx;
    p.by += dy;
    if (usesOrthoRoute(p)) {
      var hist = ensurePathHistory(p);
      var i;
      for (i = 0; i < hist.length; i++) {
        hist[i].x += dx;
        hist[i].y += dy;
      }
      syncPathAlias(p);
    }
  }

  /** Hard wall — yellow jacket frontier may not cross rulerStopX (toward blade). */
  function enforceRulerWall(p, rulerStopX) {
    if (!p || rulerStopX == null) return;
    var i;
    for (i = 0; i < 12; i++) {
      var boundary = getJacketBoundaryWorld(p);
      if (!boundary || boundary.x <= rulerStopX + RULER_WALL_EPS) return;
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
  }

  function bareTipSpanX(bladeX, rulerStopX) {
    var wallX = rulerStopX;
    var blade = bladeX;
    if (!isFinite(wallX) || !isFinite(blade)) {
      return { minX: wallX, maxX: blade };
    }
    /* Bare zone: jacket wall (left/smaller X) → blade/anvil (right/larger X). */
    return {
      minX: Math.min(wallX, blade),
      maxX: Math.max(wallX, blade),
    };
  }

  function flattenOrthoForCleaverSlot(p, tipX, grooveY) {
    if (!usesOrthoRoute(p)) return;
    ensurePathHistory(p);
    var hist = p.pathHistory;
    var start = strainReliefStart(p);
    var inland = Math.max(ORTHO_MIN_SEG, 16);
    var tipFromEast = tipX >= start.x;
    var inlandX = tipFromEast ? tipX - inland : tipX + inland;
    if (!hist.length) {
      hist.push({ x: inlandX, y: grooveY });
    } else {
      var last = hist[hist.length - 1];
      if (Math.abs(last.y - grooveY) > 0.5) {
        hist.push({ x: last.x, y: grooveY });
      }
      last = hist[hist.length - 1];
      if (Math.abs(last.x - tipX) < ORTHO_MIN_SEG) {
        hist[hist.length - 1] = { x: inlandX, y: grooveY };
      }
    }
    p.pathHistory = hist;
    syncPathAlias(p);
    if (p.snake) {
      p.snake.axis = 'h';
      p.snake.ghost = null;
    }
  }

  /**
   * Shift whole tail so yellow jacket frontier (jacketTo) meets the ruler stop wall.
   */
  function alignJacketToRulerWall(p, slot) {
    if (!p || !slot || slot.rulerStopX == null || slot.grooveY == null) return false;
    var grooveY = slot.grooveY;
    var rulerStopX = slot.rulerStopX;
    p.by = grooveY;
    flattenOrthoForCleaverSlot(p, p.bx, grooveY);
    var boundary = getJacketBoundaryWorld(p);
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWall(p, rulerStopX);
    p.by = Math.round(grooveY);
    return true;
  }

  /**
   * Pin jacket frontier on ruler stop; bare glass may extend toward blade only.
   */
  function pinJacketToRulerWall(p, slot, desiredTipX) {
    if (!p || !slot) return false;
    var rulerStopX = slot.rulerStopX;
    var grooveY = slot.grooveY;
    var bladeX = slot.bladeX;
    if (rulerStopX == null || grooveY == null || bladeX == null) return false;

    if (!alignJacketToRulerWall(p, slot)) return false;

    var span = bareTipSpanX(bladeX, rulerStopX);
    if (span.maxX - span.minX < ORTHO_MIN_SEG) return false;
    var tipX = Math.max(span.minX, Math.min(span.maxX, desiredTipX));
    p.bx = tipX;
    flattenOrthoForCleaverSlot(p, tipX, grooveY);

    var iter;
    for (iter = 0; iter < 12; iter++) {
      var boundary = getJacketBoundaryWorld(p);
      var err = boundary.x - rulerStopX;
      if (Math.abs(err) < RULER_WALL_EPS) break;
      translateTailGeometry(p, -err, 0);
      p.bx = tipX;
      flattenOrthoForCleaverSlot(p, tipX, grooveY);
    }
    enforceRulerWall(p, rulerStopX);
    p.bx = Math.round(tipX);
    p.by = Math.round(grooveY);
    return true;
  }

  /** Seat fiber in ruler slot — jacket locked at wall, bare tip toward blade. */
  function seatFiberInCleaverSlot(p, cleaverId, end) {
    return seatFiberOnCleaverDrop(p, cleaverId, end);
  }

  function refreshPigtailCleaverSlot(pigtailId, cleaverId) {
    var p = findPigtail(pigtailId);
    if (!p) return;
    var slot = getCleaverSlotGeometry(cleaverId);
    var startDocked = isCable(p) && p.startIsSnappedToCleaver && p.startSnappedCleaverId === cleaverId;
    var endDocked = p.isSnappedToCleaver && p.snappedCleaverId === cleaverId;
    if (!startDocked && !endDocked) return;
    if (!slot || !slot.open) {
      if (startDocked) clearCleaverSnap(p, { end: 'start' });
      if (endDocked) clearCleaverSnap(p, { end: 'end' });
      return;
    }
    if (startDocked) {
      seatFiberOnCleaverDrop(p, cleaverId, 'start');
      p.startCleaverSlotAnchorX = slot.rulerStopX;
    }
    if (endDocked) {
      seatFiberOnCleaverDrop(p, cleaverId, 'end');
      p.cleaverSlotAnchorX = slot.rulerStopX;
    }
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    setCleaverRulerWallGuide(slot, true);
    updateFiberPath(p);
  }

  function updateCleaverSnapVisual(p, end) {
    if (!layer || !p) return;
    end = isCable(p) ? resolveCableEnd(p, end) : 'end';
    var label = end === 'start' ? 'A' : 'B';
    var btn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="' + label + '"]');
    if (!btn) return;
    var docked = end === 'start' ? !!p.startIsSnappedToCleaver : !!p.isSnappedToCleaver;
    btn.classList.toggle('is-cleaver-docked', docked);
  }

  function clearCleaverSnap(p, opts) {
    opts = opts || {};
    if (!p) return;
    var end = isCable(p) ? resolveCableEnd(p, opts.end) : 'end';
    var cleaverId = end === 'start' ? p.startSnappedCleaverId : p.snappedCleaverId;
    if (end === 'start') {
      p.startIsSnappedToCleaver = false;
      p.startSnappedCleaverId = null;
      p.startCleaverSlotAnchorX = null;
    } else {
      p.isSnappedToCleaver = false;
      p.snappedCleaverId = null;
      p.cleaverSlotAnchorX = null;
    }
    if (cleaverId && global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, null);
    }
    updateCleaverSnapVisual(p, end);
    if (isCable(p)) restoreCableEndStripFrontier(p, end);
    else restorePermanentStripFrontier(p);
    if (!opts.skipGuide) clearCleaverGuideLine();
    clearCleaverDropzoneHighlight();
  }

  function lockTipInCleaverGroove(p, cleaverId) {
    seatFiberInCleaverSlot(p, cleaverId);
  }

  function snapPigtailToCleaverGroove(p, cleaverId, snapX, grooveY, opts) {
    opts = opts || {};
    var end = isCable(p) ? resolveCableEnd(p, opts.end) : 'end';
    if (!p || isCableEndCleaved(p, end)) return false;
    if (getCableEndStripStage(p, end) < 2) return false;
    if (!isCable(p) && p.tail && p.tail.attached) return false;
    if (!seatFiberOnCleaverDrop(p, cleaverId, end)) return false;
    if (global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, p.id);
    }
    var slot = getCleaverSlotGeometry(cleaverId);
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    if (slot) setCleaverRulerWallGuide(slot, true);
    updateCleaverSnapVisual(p, end);
    if (!opts.quiet) {
      setStatus((isCable(p) ? 'Cable' : 'SC Pigtail') + ' · ' + end +
        ' end · jacket seated against cleaver ruler · bare glass in groove');
    }
    return true;
  }

  function findCleaverGrooveSnapForTip(p, tipX, tipY, end) {
    if (!global.FtthLab || typeof FtthLab.findCleaverGrooveNear !== 'function') return null;
    end = isCable(p) ? resolveCableEnd(p, end) : 'end';
    if (!p || isCableEndCleaved(p, end)) return null;
    if (getCableEndStripStage(p, end) < 2) return null;
    if (!isCable(p) && p.tail && p.tail.attached) return null;
    return FtthLab.findCleaverGrooveNear(tipX, tipY, CLEAVER_SNAP_PX);
  }

  function setCleaverDropzoneHighlight(cleaverId) {
    if (global.FtthLab && typeof FtthLab.setCleaverDropzoneActive === 'function') {
      FtthLab.setCleaverDropzoneActive(cleaverId, true);
    }
  }

  function clearCleaverDropzoneHighlight() {
    if (global.FtthLab && typeof FtthLab.clearCleaverDropzones === 'function') {
      FtthLab.clearCleaverDropzones();
    }
  }

  function cleaverEligibleForDropzone(p, end) {
    end = resolveCableEnd(p, end);
    if (!p || isCableEndCleaved(p, end)) return false;
    if (getCableEndStripStage(p, end) < 2) return false;
    if (!isCable(p) && p.tail && p.tail.attached) return false;
    return true;
  }

  /**
   * Snap on release only: lock Y to groove, shift tail so jacketTo meets ruler stop (art X=305).
   */
  function flattenOrthoForCleaverSlotEnd(p, tipX, grooveY, end) {
    end = resolveCableEnd(p, end);
    if (!usesOrthoRoute(p)) return;
    ensurePathHistory(p);
    var hist = p.pathHistory;
    var inland = Math.max(ORTHO_MIN_SEG, 16);
    if (end === 'start') {
      var tipFromWest = tipX <= (p.bx || tipX);
      var inlandX = tipFromWest ? tipX + inland : tipX - inland;
      if (!hist.length) {
        hist.push({ x: inlandX, y: grooveY });
      } else {
        var first = hist[0];
        if (Math.abs(first.y - grooveY) > 0.5) {
          hist.unshift({ x: first.x, y: grooveY });
        }
        first = hist[0];
        if (Math.abs(first.x - tipX) < ORTHO_MIN_SEG) {
          hist[0] = { x: inlandX, y: grooveY };
        }
      }
    } else {
      flattenOrthoForCleaverSlot(p, tipX, grooveY);
      return;
    }
    p.pathHistory = hist;
    syncPathAlias(p);
    if (p.snake) {
      p.snake.axis = 'h';
      p.snake.ghost = null;
    }
  }

  function enforceRulerWallForEnd(p, rulerStopX, end) {
    if (!p || rulerStopX == null) return;
    end = resolveCableEnd(p, end);
    var i;
    for (i = 0; i < 12; i++) {
      var boundary = getJacketBoundaryWorld(p, end);
      if (!boundary || boundary.x <= rulerStopX + RULER_WALL_EPS) return;
      translateCableEndGeometry(p, end, rulerStopX - boundary.x, 0);
    }
  }

  function seatFiberOnCleaverDrop(p, cleaverId, end) {
    end = resolveCableEnd(p, end);
    if (!cleaverEligibleForDropzone(p, end)) return false;
    var slot = getCleaverSlotGeometry(cleaverId);
    if (!slot || !slot.open || slot.grooveY == null || slot.rulerStopX == null) return false;

    var grooveY = slot.grooveY;
    var rulerStopX = slot.rulerStopX;
    var bladeX = slot.bladeX;
    var span = bareTipSpanX(bladeX, rulerStopX);
    if (span.maxX - span.minX < ORTHO_MIN_SEG) return false;

    var tipX;
    if (end === 'start') {
      p.ay = Math.round(grooveY);
      flattenOrthoForCleaverSlotEnd(p, p.ax, grooveY, 'start');
      var boundaryStart = getJacketBoundaryWorld(p, 'start');
      if (boundaryStart) translateCableEndGeometry(p, 'start', rulerStopX - boundaryStart.x, 0);
      enforceRulerWallForEnd(p, rulerStopX, 'start');
      tipX = Math.max(span.minX, Math.min(span.maxX, p.ax));
      p.ax = tipX;
      flattenOrthoForCleaverSlotEnd(p, tipX, grooveY, 'start');
      boundaryStart = getJacketBoundaryWorld(p, 'start');
      if (boundaryStart) translateCableEndGeometry(p, 'start', rulerStopX - boundaryStart.x, 0);
      enforceRulerWallForEnd(p, rulerStopX, 'start');
      var iterS;
      for (iterS = 0; iterS < 16; iterS++) {
        boundaryStart = getJacketBoundaryWorld(p, 'start');
        if (!boundaryStart || Math.abs(boundaryStart.x - rulerStopX) < RULER_WALL_EPS) break;
        translateCableEndGeometry(p, 'start', rulerStopX - boundaryStart.x, 0);
      }
      p.ax = Math.round(Math.max(span.minX, Math.min(span.maxX, p.ax)));
      p.ay = Math.round(grooveY);
      p.startIsSnappedToCleaver = true;
      p.startSnappedCleaverId = cleaverId;
      p.startCleaverSlotAnchorX = rulerStopX;
      p.activeCableEnd = 'start';
      p.mountedCleaverEnd = 'start';
      lockCableEndStripFrontier(p, 'start');
      return true;
    }

    p.by = Math.round(grooveY);
    flattenOrthoForCleaverSlot(p, p.bx, grooveY);

    var boundary = getJacketBoundaryWorld(p, 'end');
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWallForEnd(p, rulerStopX, 'end');

    tipX = Math.max(span.minX, Math.min(span.maxX, p.bx));
    p.bx = tipX;
    flattenOrthoForCleaverSlot(p, tipX, grooveY);
    boundary = getJacketBoundaryWorld(p, 'end');
    if (boundary) {
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }
    enforceRulerWallForEnd(p, rulerStopX, 'end');

    var iter;
    for (iter = 0; iter < 16; iter++) {
      boundary = getJacketBoundaryWorld(p, 'end');
      if (!boundary || Math.abs(boundary.x - rulerStopX) < RULER_WALL_EPS) break;
      translateTailGeometry(p, rulerStopX - boundary.x, 0);
    }

    p.bx = Math.round(Math.max(span.minX, Math.min(span.maxX, p.bx)));
    p.by = Math.round(grooveY);
    p.isSnappedToCleaver = true;
    p.snappedCleaverId = cleaverId;
    p.cleaverSlotAnchorX = rulerStopX;
    if (isCable(p)) {
      p.activeCableEnd = 'end';
      p.mountedCleaverEnd = 'end';
      lockCableEndStripFrontier(p, 'end');
    } else {
      lockPermanentStripFrontier(p);
    }
    return true;
  }

  function finishCleaverDropSeat(p, cleaverId, end) {
    end = resolveCableEnd(p, end);
    if (isCable(p)) p.activeCableEnd = end;
    if (!seatFiberOnCleaverDrop(p, cleaverId, end)) return false;
    if (global.FtthLab && typeof FtthLab.setCleaverDockedPigtail === 'function') {
      FtthLab.setCleaverDockedPigtail(cleaverId, p.id);
    }
    var slot = getCleaverSlotGeometry(cleaverId);
    var guide = cleaverSlotGuideFromInfo(slot);
    if (guide) setCleaverGuideLine(guide, true);
    if (slot) setCleaverRulerWallGuide(slot, true);
    updateCleaverSnapVisual(p, end);
    updateFiberPath(p);
    setStatus((isCable(p) ? 'Cable' : 'SC Pigtail') + ' · ' + end +
      ' end · jacket seated against cleaver ruler · bare glass in groove');
    return true;
  }

  /** Bare stripped tip probe for cleaver secondary snap. */
  function findBareTipNearWorld(wx, wy, radiusPx) {
    var thr = typeof radiusPx === 'number' ? radiusPx : CLEAVER_SNAP_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var ends = isCable(p) ? ['start', 'end'] : ['end'];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!p || isCableEndCleaved(p, end)) continue;
        if (getCableEndStripStage(p, end) < 2) continue;
        if (!isCable(p) && p.tail && p.tail.attached) continue;
        var tip = cableEndTipWorld(p, end);
        var d = dist2(wx, wy, tip.x, tip.y);
        if (d <= thr && d < bestD) {
          bestD = d;
          best = { id: fiberTargetId(p, end), end: end, x: tip.x, y: tip.y, dist: d };
        }
      }
    }
    return best;
  }

  function undockPigtailsFromCleaver(cleaverId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (p.isSnappedToCleaver && p.snappedCleaverId === cleaverId) {
        clearCleaverSnap(p, { skipGuide: true });
        changed = true;
      }
      if (isCable(p) && p.startIsSnappedToCleaver && p.startSnappedCleaverId === cleaverId) {
        clearCleaverSnap(p, { skipGuide: true, end: 'start' });
        changed = true;
      }
    });
    if (changed) clearCleaverGuideLine();
    if (changed) rebuildLayer();
  }

  function finalizePigtailCleaverDock(pigtailId) {
    var p = findPigtail(pigtailId);
    if (!p) {
      clearCleaverGuideLine();
      return;
    }
    var cleaverId = null;
    if (isCable(p) && p.startIsSnappedToCleaver) cleaverId = p.startSnappedCleaverId;
    else if (p.isSnappedToCleaver) cleaverId = p.snappedCleaverId;
    if (!cleaverId) {
      clearCleaverGuideLine();
      return;
    }
    refreshPigtailCleaverSlot(pigtailId, cleaverId);
    pushHistory();
    setStatus((isCable(p) ? 'Cable' : 'SC Pigtail') +
      ' · jacket seated against cleaver ruler · bare glass in groove');
  }

  /* ─── Fusion splicer clamp V-groove snap (cleaved pigtails) ─── */

  function splicerEligibleForSnap(p, end) {
    if (!p) return false;
    end = resolveMemberEnd(p, end);
    if (isMemberEndFusionPermanent(p, end)) return false;
    if (isCable(p)) {
      /* Match pigtail leniency: cleaved OR fully stripped — not stripped+cleaned+cleaved. */
      if (!isCableEndCleaved(p, end) && !isCableEndFullyStripped(p, end)) return false;
      if (cableEndIsSnappedToCleaver(p, end)) return false;
      if (cableEndIsSnappedToSplicer(p, end) && isMemberEndFused(p, end)) return false;
      return true;
    }
    if (!(p.isCleaved || p.cleaved) && !isFullyStrippedPigtail(p)) return false;
    if (p.tail && p.tail.attached) return false;
    if (p.isSnappedToCleaver) return false;
    if (p.isSnappedToSplicer && isMemberEndFused(p, 'end')) return false;
    return true;
  }

  function getSplicerGrooveSlot(machineId, side, opts) {
    opts = opts || {};
    if (!global.FusionSplicerMachine) return null;
    if (opts.forTracking && typeof FusionSplicerMachine.getGrooveSlotForTracking === 'function') {
      return FusionSplicerMachine.getGrooveSlotForTracking(machineId, side);
    }
    if (typeof FusionSplicerMachine.getGrooveSlot === 'function') {
      return FusionSplicerMachine.getGrooveSlot(machineId, side);
    }
    return null;
  }

  function findSnappedPigtailOnSide(machineId, side, exceptId, exceptEnd) {
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var cand = pigtails[i];
      if (exceptId && cand.id === exceptId) continue;
      if (isCable(cand)) {
        if (
          !(exceptId === cand.id && exceptEnd === 'start') &&
          cand.startIsSnappedToSplicer &&
          cand.startSnappedSplicerId === machineId &&
          cand.startSnappedSplicerSide === side
        ) {
          return cableSplicerDockAdapter(cand, 'start');
        }
        if (
          !(exceptId === cand.id && exceptEnd === 'end') &&
          cand.isSnappedToSplicer &&
          cand.snappedSplicerId === machineId &&
          cand.snappedSplicerSide === side
        ) {
          return cableSplicerDockAdapter(cand, 'end');
        }
        continue;
      }
      if (
        cand.isSnappedToSplicer &&
        cand.snappedSplicerId === machineId &&
        cand.snappedSplicerSide === side
      ) {
        return cand;
      }
    }
    return null;
  }

  function cableSplicerDockAdapter(p, end) {
    end = cableEndFromToken(end);
    syncCablePrepState(p);
    var stripStage = getCableEndStripStage(p, end);
    var isStripped = end === 'start'
      ? !!(p.startIsStripped || stripStage >= 1)
      : !!(p.isStripped || stripStage >= 1);
    return {
      id: p.id,
      type: 'cable',
      cableEnd: end,
      targetId: fiberTargetId(p, end),
      bx: end === 'start' ? p.ax : p.bx,
      by: end === 'start' ? p.ay : p.by,
      isSnappedToSplicer: cableEndSnappedToSplicer(p, end),
      snappedSplicerId: end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId,
      snappedSplicerSide: end === 'start' ? p.startSnappedSplicerSide : p.snappedSplicerSide,
      isStripped: isStripped,
      isCleaned: isCableEndCleaned(p, end),
      isCleaved: isCableEndCleaved(p, end),
      cleaved: isCableEndCleaved(p, end),
      stripStage: stripStage,
      fiberStrip: ensureCableEndStrip(p, end),
      connector: { attached: null, mismatch: false },
      tail: { attached: null },
    };
  }

  function getSplicerDockedPair(machineId) {
    var left = null;
    var right = null;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (isCable(p)) {
        if (p.startIsSnappedToSplicer && p.startSnappedSplicerId === machineId) {
          if (p.startSnappedSplicerSide === 'L') left = cableSplicerDockAdapter(p, 'start');
          if (p.startSnappedSplicerSide === 'R') right = cableSplicerDockAdapter(p, 'start');
        }
        if (p.isSnappedToSplicer && p.snappedSplicerId === machineId) {
          if (p.snappedSplicerSide === 'L') left = cableSplicerDockAdapter(p, 'end');
          if (p.snappedSplicerSide === 'R') right = cableSplicerDockAdapter(p, 'end');
        }
        continue;
      }
      if (!p.isSnappedToSplicer || p.snappedSplicerId !== machineId) continue;
      if (p.snappedSplicerSide === 'L') left = p;
      if (p.snappedSplicerSide === 'R') right = p;
    }
    return { left: left, right: right };
  }

  function setFiberFusedState(machineId, fused) {
    if (!fused) {
      syncGlobalFiberFusedFlag();
      return;
    }
    if (machineId) {
      if (!global.__fiberFusedMachines) global.__fiberFusedMachines = {};
      global.__fiberFusedMachines[machineId] = true;
      global.isFiberFused = true;
    }
  }

  function isFusedAssembly(assemblyId) {
    return !!(assemblyId && fusedAssemblies[assemblyId]);
  }

  function isPigtailFused(p, end) {
    if (!p) return false;
    if (end != null) return isMemberEndFused(p, end);
    if (isCable(p)) {
      return isMemberEndFused(p, 'start') || isMemberEndFused(p, 'end');
    }
    return isMemberEndFused(p, 'end');
  }

  function getFusedAssemblyPigtails(assemblyId) {
    var asm = fusedAssemblies[assemblyId];
    if (!asm) return { left: null, right: null };
    return {
      left: findPigtail(asm.leftId),
      right: findPigtail(asm.rightId),
    };
  }

  function getFusedPartner(p, end) {
    if (!p) return null;
    if (isCable(p) && end == null) {
      end = resolveMemberEnd(p, p.activeCableEnd);
      if (isMemberEndFused(p, end)) return getFusedPartnerForEnd(p, end);
      return getFusedPartnerForEnd(p, 'start') || getFusedPartnerForEnd(p, 'end');
    }
    if (end != null) {
      return isMemberEndFused(p, end) ? getFusedPartnerForEnd(p, end) : null;
    }
    if (!isMemberEndFused(p, 'end')) return null;
    return getFusedPartnerForEnd(p, 'end');
  }

  function updateFusedAssemblyBridgeFromSlots(machineId, slotL, slotR) {
    var asm = fusedAssemblies[machineId];
    if (!asm || !slotL || !slotR) return;
    asm.bridgeX1 = slotL.innerEdgeX;
    asm.bridgeX2 = slotR.innerEdgeX;
    asm.bridgeY = (slotL.grooveY + slotR.grooveY) / 2;
    asm.meetX = (slotL.innerEdgeX + slotR.innerEdgeX) / 2;
  }

  function registerFusedAssembly(machineId, opts) {
    opts = opts || {};
    var pair = getSplicerDockedPair(machineId);
    if (!pair.left || !pair.right) return false;
    var fusionId = makeFusionAssemblyId(pair.left.id, pair.right.id);
    if (!fusionId) return false;
    var existing = fusedAssemblies[fusionId];
    if (existing && isFusionAssemblyPermanent(existing)) {
      return true;
    }
    var slotL = getSplicerGrooveSlot(machineId, 'L', { forTracking: true });
    var slotR = getSplicerGrooveSlot(machineId, 'R', { forTracking: true });
    var meetX = slotL && slotR
      ? (slotL.innerEdgeX + slotR.innerEdgeX) / 2
      : pair.left.bx;
    var grooveY = slotL && slotR
      ? (slotL.grooveY + slotR.grooveY) / 2
      : pair.left.by;
    var spliceLossDb = typeof opts.lossDb === 'number' && isFinite(opts.lossDb)
      ? opts.lossDb
      : (typeof opts.loss === 'number' && isFinite(opts.loss)
        ? opts.loss
        : (existing && typeof existing.spliceLossDb === 'number' ? existing.spliceLossDb : null));
    fusedAssemblies[fusionId] = {
      fusionAssemblyId: fusionId,
      machineId: machineId,
      leftId: pair.left.id,
      rightId: pair.right.id,
      leftKey: (function () {
        var lp = findPigtail(pair.left.id);
        return lp ? opticalEndpointKey(lp, dockedMemberCableEnd(pair.left)) : null;
      })(),
      rightKey: (function () {
        var rp = findPigtail(pair.right.id);
        return rp ? opticalEndpointKey(rp, dockedMemberCableEnd(pair.right)) : null;
      })(),
      bridgeX1: slotL ? slotL.innerEdgeX : pair.left.bx,
      bridgeX2: slotR ? slotR.innerEdgeX : pair.right.bx,
      bridgeY: grooveY,
      meetX: meetX,
      spliceLossDb: spliceLossDb,
      loss: spliceLossDb,
      isOvenDocked: false,
      ovenPreviewSlot: null,
      heatPhase: 'idle',
      heatProgress: 0,
      sleeveShrunk: !!(existing && existing.sleeveShrunk),
      permanent: !!(existing && existing.permanent),
      ovenChannel: null,
      ovenGrooveAnchor: null,
      ovenDockSnapshot: null,
    };
    applyFusionStateToMember(pair.left, fusionId, machineId, 'L', pair.right.id);
    applyFusionStateToMember(pair.right, fusionId, machineId, 'R', pair.left.id);
    var leftReal = resolveDockedMember(pair.left);
    var rightReal = resolveDockedMember(pair.right);
    if (leftReal) captureFusedJacketEndDist(leftReal, machineId, 'L', dockedMemberCableEnd(pair.left));
    if (rightReal) captureFusedJacketEndDist(rightReal, machineId, 'R', dockedMemberCableEnd(pair.right));
    setFiberFusedState(machineId, true);
    syncGlobalFiberFusedFlag();
    return true;
  }

  function clearFusedAssembly(assemblyId) {
    if (!assemblyId) return;
    var asm = fusedAssemblies[assemblyId];
    if (!asm || isFusionAssemblyPermanent(asm)) return;
    var pair = getFusedAssemblyPigtails(assemblyId);
    if ((pair.left && isMemberFusionLiftedFromSplicer(pair.left)) ||
        (pair.right && isMemberFusionLiftedFromSplicer(pair.right))) {
      return;
    }
    if (pair.left) {
      var leftEnd = isCable(pair.left) ? getCableFusedEnd(pair.left, asm) : 'end';
      if (!isMemberEndFusionPermanent(pair.left, leftEnd)) {
        clearMemberEndFusionFields(pair.left, leftEnd);
      }
    }
    if (pair.right) {
      var rightEnd = isCable(pair.right) ? getCableFusedEnd(pair.right, asm) : 'end';
      if (!isMemberEndFusionPermanent(pair.right, rightEnd)) {
        clearMemberEndFusionFields(pair.right, rightEnd);
      }
    }
    delete fusedAssemblies[assemblyId];
    syncGlobalFiberFusedFlag();
    syncGlobalSleeveShrunkFlag();
  }

  function syncGlobalSleeveShrunkFlag() {
    var any = false;
    Object.keys(fusedAssemblies).forEach(function (mid) {
      var asm = fusedAssemblies[mid];
      if (asm && asm.sleeveShrunk) any = true;
    });
    global.isSleeveShrunk = any;
    if (typeof window !== 'undefined') window.isSleeveShrunk = any;
  }

  function markFusedAssemblySleeveShrunk(assemblyId, shrunk) {
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    var pair = getFusedAssemblyPigtails(assemblyId);
    if (asm) {
      asm.sleeveShrunk = !!shrunk;
      asm.permanent = !!shrunk;
    }
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      if (isCable(pg)) {
        var end = getCableFusedEnd(pg, asm);
        if (end) setMemberEndFusionPermanent(pg, end, shrunk);
      } else {
        setMemberEndFusionPermanent(pg, 'end', shrunk);
      }
    });
    syncGlobalSleeveShrunkFlag();
  }

  function ensureFusedAssemblyOvenState(assemblyIdOrMachine) {
    var assemblyId = resolveFusionAssemblyId(assemblyIdOrMachine, { preferDocked: true, preferHeating: true }) ||
      assemblyIdOrMachine;
    var asm = assemblyId ? fusedAssemblies[assemblyId] : null;
    if (!asm) return null;
    if (asm.isOvenDocked == null) asm.isOvenDocked = false;
    if (asm.heatPhase == null) asm.heatPhase = 'idle';
    if (asm.heatProgress == null) asm.heatProgress = 0;
    if (asm.sleeveShrunk == null) asm.sleeveShrunk = false;
    return asm;
  }

  function isFusedAssemblySleeveShrunk(assemblyIdOrMachine) {
    var assemblyId = resolveFusionAssemblyId(assemblyIdOrMachine);
    var asm = assemblyId ? ensureFusedAssemblyOvenState(assemblyId) : null;
    return !!(asm && asm.sleeveShrunk);
  }

  function pigtailHasAnySleeve(p) {
    if (!p) return false;
    if (!isCable(p)) return !!p.hasSleeve;
    return pigtailEndHasSleeve(p, 'start') || pigtailEndHasSleeve(p, 'end');
  }

  function fusedAssemblyHasShrinkSleeve(machineId) {
    var pair = getFusedAssemblyPigtails(machineId);
    return !!(pigtailHasAnySleeve(pair.left) || pigtailHasAnySleeve(pair.right));
  }

  function ovenDragBlockedMessage(p, end) {
    if (!p) return '';
    end = resolveMemberEnd(p, end);
    if (!isMemberEndFused(p, end)) return '';
    if (isFusedAssemblyHeatLocked(getMemberEndFusionAssemblyId(p, end))) {
      return 'Heat oven · cable locked while shrinking';
    }
    return '';
  }

  function isFusedAssemblyOvenDocked(assemblyIdOrMachine) {
    var assemblyId = resolveFusionAssemblyId(assemblyIdOrMachine, { preferDocked: true });
    var asm = assemblyId ? ensureFusedAssemblyOvenState(assemblyId) : null;
    return !!(asm && asm.isOvenDocked);
  }

  function isFusedAssemblyHeatLocked(machineId) {
    var asm = ensureFusedAssemblyOvenState(machineId);
    return !!(asm && asm.heatPhase === 'heating');
  }

  function isPigtailOvenDragLocked(p, end) {
    if (!p) return false;
    end = resolveMemberEnd(p, end);
    if (!isMemberEndFused(p, end)) return false;
    return isFusedAssemblyHeatLocked(getMemberEndFusionAssemblyId(p, end));
  }

  function canLiftFusedAssemblyFromOven(machineId) {
    var asm = ensureFusedAssemblyOvenState(machineId);
    if (!asm || !asm.isOvenDocked) return true;
    if (asm.heatPhase === 'heating') return false;
    return true;
  }

  function resolveOvenSlotAnchorY(slot) {
    if (!slot) return 0;
    return slot.channelY != null ? slot.channelY : slot.centerY;
  }

  function fusedAssemblyChainAnchorId(assemblyId) {
    var pair = getFusedAssemblyPigtails(assemblyId);
    if (pair.left) return pair.left.id;
    if (pair.right) return pair.right.id;
    return null;
  }

  /** Rigid shift every member + registry joint in the welded chain graph. */
  function translateFusedAssemblyChainRigid(assemblyId, dx, dy) {
    var anchorId = fusedAssemblyChainAnchorId(assemblyId);
    if (!anchorId) return null;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
    var comp = translateFusedChainRigid(anchorId, dx, dy);
    if (comp) refreshFusedChainMembersAfterRigidShift(anchorId);
    return comp;
  }

  function syncFusedChainVisualsFromAssembly(assemblyId) {
    var anchorId = fusedAssemblyChainAnchorId(assemblyId);
    if (!anchorId) return;
    var comp = collectFusedChainComponent(anchorId);
    comp.assemblyIds.forEach(function (aid) {
      syncFusedAssemblyVisuals(aid);
    });
  }

  function captureOvenDockSnapshot(assemblyId) {
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    var anchorId = fusedAssemblyChainAnchorId(assemblyId);
    if (!asm || !anchorId) return;
    asm.ovenDockSnapshot = createFusedChainDragSnapshot(anchorId);
  }

  /** Oven channel metadata only — never mutates member paths or weld tips. */
  function updateOvenChannelMetadata(assemblyId, slot) {
    if (!slot) return;
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (!asm) return;
    var cy = resolveOvenSlotAnchorY(slot);
    asm.ovenChannel = {
      x1: slot.channelX1,
      x2: slot.channelX2,
      cx: slot.centerX,
      cy: cy,
    };
  }

  function getSplicerMachineForAssembly(assemblyId) {
    return getFusionAssemblyMachineId(assemblyId) || assemblyId;
  }

  function syncOvenDockedAssemblyToLiveSlot(assemblyId) {
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (!asm || !asm.isOvenDocked || asm.sleeveShrunk) return false;
    if (!global.FusionSplicerMachine || typeof FusionSplicerMachine.getOvenSlot !== 'function') {
      return false;
    }
    var slot = FusionSplicerMachine.getOvenSlot(getSplicerMachineForAssembly(assemblyId));
    if (!slot) return false;
    var weld = getFusedWeldWorld(assemblyId);
    if (!weld) return false;
    var slotY = resolveOvenSlotAnchorY(slot);
    var dx = slot.centerX - weld.x;
    var dy = slotY - weld.y;
    var channelChanged = !asm.ovenChannel ||
      asm.ovenChannel.x1 !== slot.channelX1 ||
      asm.ovenChannel.x2 !== slot.channelX2 ||
      asm.ovenChannel.cx !== slot.centerX ||
      asm.ovenChannel.cy !== slotY;
    if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05 && !channelChanged) return false;
    if (Math.abs(dx) >= 0.05 || Math.abs(dy) >= 0.05) {
      translateFusedAssemblyChainRigid(assemblyId, dx, dy);
    }
    updateOvenChannelMetadata(assemblyId, slot);
    asm.ovenGrooveAnchor = { x: slot.centerX, y: slotY };
    return true;
  }

  var ovenDockTrackRafId = null;

  function ovenDockTrackTick() {
    var anyDocked = false;
    var changed = false;
    Object.keys(fusedAssemblies).forEach(function (mid) {
      var asm = fusedAssemblies[mid];
      if (!asm || !asm.isOvenDocked || asm.sleeveShrunk) return;
      anyDocked = true;
      if (syncOvenDockedAssemblyToLiveSlot(mid)) {
        changed = true;
        syncFusedChainVisualsFromAssembly(mid);
      }
    });
    if (changed && layer) rebuildLayer();
    if (anyDocked) {
      ovenDockTrackRafId = requestAnimationFrame(ovenDockTrackTick);
    } else {
      ovenDockTrackRafId = null;
    }
  }

  function ensureOvenDockTracking() {
    if (ovenDockTrackRafId != null) return;
    ovenDockTrackRafId = requestAnimationFrame(ovenDockTrackTick);
  }

  function stopOvenDockTracking() {
    if (ovenDockTrackRafId != null) {
      cancelAnimationFrame(ovenDockTrackRafId);
      ovenDockTrackRafId = null;
    }
  }

  function markFusedAssemblyOvenDocked(assemblyId, docked) {
    var anchorId = fusedAssemblyChainAnchorId(assemblyId);
    if (!anchorId) return;
    var splicerId = getSplicerMachineForAssembly(assemblyId);
    var comp = collectFusedChainComponent(anchorId);
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      if (!pg) return;
      pg.isOvenDocked = !!docked;
      pg.ovenDockMachineId = docked ? splicerId : null;
    });
  }

  function seatFusedAssemblyInOven(machineId, slot) {
    if (!machineId || !slot || isFusedAssemblyHeatLocked(machineId)) return false;
    var asm = ensureFusedAssemblyOvenState(machineId);
    var pair = getFusedAssemblyPigtails(machineId);
    if (!asm || !pair.left || !pair.right) return false;

    captureOvenDockSnapshot(machineId);
    var weld = getFusedWeldWorld(machineId);
    if (!weld) return false;
    var slotY = resolveOvenSlotAnchorY(slot);
    var dx = slot.centerX - weld.x;
    var dy = slotY - weld.y;
    translateFusedAssemblyChainRigid(machineId, dx, dy);
    updateOvenChannelMetadata(machineId, slot);

    asm.isOvenDocked = true;
    asm.heatPhase = 'docked';
    asm.heatProgress = 0;
    asm.ovenPreviewSlot = null;
    asm.ovenGrooveAnchor = { x: slot.centerX, y: slotY };
    markFusedAssemblyOvenDocked(machineId, true);

    ensureOvenDockTracking();
    syncFusedChainVisualsFromAssembly(machineId);
    rebuildLayer();
    pushHistory();
    setStatus('Fused splice · seated in heat oven · press HEAT');
    return true;
  }

  function restoreOvenDockSnapshotPaths(machineId) {
    var asm = ensureFusedAssemblyOvenState(machineId);
    if (!asm || !asm.ovenDockSnapshot) return false;
    var snap = asm.ovenDockSnapshot;
    if (snap.members && snap.members.length) {
      var i;
      for (i = 0; i < snap.members.length; i++) {
        var m = snap.members[i];
        var pg = findPigtail(m.id);
        if (!pg) continue;
        pg.ax = m.oax;
        pg.ay = m.oay;
        pg.bx = m.obx;
        pg.by = m.oby;
        pg.pathHistory = cloneJson(m.hist0 || []);
        syncPathAlias(pg);
        updateFiberPath(pg);
      }
      if (snap.assemblies && snap.assemblies.length) {
        for (i = 0; i < snap.assemblies.length; i++) {
          var a = snap.assemblies[i];
          var reg = fusedAssemblies[a.id];
          if (!reg) continue;
          if (a.meetX != null && isFinite(a.meetX)) reg.meetX = a.meetX;
          if (a.bridgeY != null && isFinite(a.bridgeY)) reg.bridgeY = a.bridgeY;
          if (a.bridgeX1 != null && isFinite(a.bridgeX1)) reg.bridgeX1 = a.bridgeX1;
          if (a.bridgeX2 != null && isFinite(a.bridgeX2)) reg.bridgeX2 = a.bridgeX2;
        }
      }
      restoreFusedChainStripFrontiers(snap);
      syncFusedChainVisualsFromAssembly(machineId);
      return true;
    }
    var pair = getFusedAssemblyPigtails(machineId);
    if (pair.left && snap.left) {
      pair.left.ax = snap.left.ax;
      pair.left.ay = snap.left.ay;
      pair.left.bx = snap.left.bx;
      pair.left.by = snap.left.by;
      pair.left.pathHistory = cloneJson(snap.left.pathHistory || []);
      syncPathAlias(pair.left);
    }
    if (pair.right && snap.right) {
      pair.right.ax = snap.right.ax;
      pair.right.ay = snap.right.ay;
      pair.right.bx = snap.right.bx;
      pair.right.by = snap.right.by;
      pair.right.pathHistory = cloneJson(snap.right.pathHistory || []);
      syncPathAlias(pair.right);
    }
    return true;
  }

  function releaseFusedAssemblyFromOven(machineId, opts) {
    opts = opts || {};
    var asm = ensureFusedAssemblyOvenState(machineId);
    if (!asm || !asm.isOvenDocked) return false;
    if (!opts.force && !canLiftFusedAssemblyFromOven(machineId)) return false;
    var weldBefore = getFusedWeldWorld(machineId);
    restoreOvenDockSnapshotPaths(machineId);
    if (opts.preserveShrink && weldBefore) {
      var weldAfter = getFusedWeldWorld(machineId);
      if (weldAfter) {
        translateFusedAssemblyChainRigid(
          machineId,
          weldBefore.x - weldAfter.x,
          weldBefore.y - weldAfter.y
        );
      }
    }
    asm.isOvenDocked = false;
    asm.ovenChannel = null;
    asm.ovenGrooveAnchor = null;
    asm.ovenPreviewSlot = null;
    markFusedAssemblyOvenDocked(machineId, false);
    stopOvenDockTracking();
    if (!opts.preserveShrink) {
      asm.heatPhase = 'idle';
      asm.heatProgress = 0;
      clearOvenSleeveShrinkVisual(machineId);
    }
    return true;
  }

  function liftFusedAssemblyFromOven(machineId) {
    return releaseFusedAssemblyFromOven(machineId, { preserveShrink: false });
  }

  function finishFusedAssemblyOvenOnDrop(machineId) {
    if (!machineId || isFusedAssemblyHeatLocked(machineId)) {
      return false;
    }
    var asm = ensureFusedAssemblyOvenState(machineId);
    if (!asm || asm.isOvenDocked) return false;
    if (!ovenEligibleForSnap(machineId)) return false;
    var slot = asm.ovenPreviewSlot;
    if (!slot) {
      slot = applyOvenMagnetDuringFusedDrag(
        machineId,
        getFusionAssemblyMachineId(machineId)
      );
    }
    if (!slot) return false;
    clearOvenMagnetHighlight();
    return seatFusedAssemblyInOven(machineId, slot);
  }

  function forEachMountedSleeve(pg, fn) {
    if (!pg || typeof fn !== 'function') return;
    if (!isCable(pg)) {
      if (pg.hasSleeve) fn(pg, 'end', pg.id);
      return;
    }
    ['start', 'end'].forEach(function (end) {
      if (!pigtailEndHasSleeve(pg, end)) return;
      fn(pg, end, fiberTargetId(pg, end));
    });
  }

  function clearOvenSleeveShrinkVisual(machineId) {
    var pair = getFusedAssemblyPigtails(machineId);
    if (!layer) return;
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      forEachMountedSleeve(pg, function (item, end, sleeveId) {
        layer.querySelectorAll('.lab-pigtail-sleeve[data-pt-sleeve="' + sleeveId + '"]').forEach(function (el) {
          el.classList.remove('is-heat-shrinking', 'is-heat-shrunk');
          el.style.removeProperty('height');
        });
      });
      if (isCable(pg)) {
        ['start', 'end'].forEach(function (end) {
          if (!isMemberEndSleeveShrunk(pg, end)) return;
          if (isMemberEndFusionPermanent(pg, end)) return;
          setMemberEndSleeveShrunk(pg, end, false);
          if (end === 'start') pg.startFusionPermanent = false;
          else pg.fusionPermanent = false;
        });
      } else if (pg.isSleeveShrunk && !isPigtailFusionPermanent(pg)) {
        pg.isSleeveShrunk = false;
        pg.fusionPermanent = false;
      }
    });
  }

  function applyOvenSleeveShrinkVisual(machineId, progress) {
    if (!layer) return;
    var pair = getFusedAssemblyPigtails(machineId);
    var t = Math.max(0, Math.min(1, (progress || 0) / 100));
    var shrinkY = 1 - t * 0.38;
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      forEachMountedSleeve(pg, function (item, end, sleeveId) {
        layer.querySelectorAll('.lab-pigtail-sleeve[data-pt-sleeve="' + sleeveId + '"]').forEach(function (el) {
          var g = sleeveGeometry(item, end);
          var h = Math.max(3, g.h * shrinkY);
          el.classList.add('is-heat-shrinking');
          el.classList.toggle('is-heat-shrunk', t >= 1);
          el.style.left = Math.round(g.x - g.w / 2) + 'px';
          el.style.top = Math.round(g.y - h / 2) + 'px';
          el.style.width = g.w + 'px';
          el.style.height = h + 'px';
          el.style.transform = 'rotate(' + g.rot.toFixed(2) + 'deg)';
          el.style.transformOrigin = '50% 50%';
        });
      });
    });
  }

  function onOvenHeatStart(machineId) {
    var assemblyId = resolveFusionAssemblyId(machineId, { preferDocked: true });
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (!asm || !asm.isOvenDocked) return false;
    asm.heatPhase = 'heating';
    asm.heatProgress = 0;
    rebuildLayer();
    applyOvenSleeveShrinkVisual(assemblyId, 0);
    syncFusedAssemblyVisuals(assemblyId);
    setStatus('Heat oven · sleeve shrinking · do not remove cable');
    return true;
  }

  function onOvenHeatProgress(machineId, progress) {
    var assemblyId = resolveFusionAssemblyId(machineId, { preferHeating: true, preferDocked: true });
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (!asm || asm.heatPhase !== 'heating') return;
    asm.heatProgress = Math.max(0, Math.min(100, progress || 0));
    applyOvenSleeveShrinkVisual(assemblyId, asm.heatProgress);
  }

  function onOvenHeatComplete(machineId) {
    var assemblyId = resolveFusionAssemblyId(machineId, { preferHeating: true, preferDocked: true });
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (!asm) return false;
    asm.heatPhase = 'ready';
    asm.heatProgress = 100;
    releaseFusedAssemblyFromOven(assemblyId, { preserveShrink: true, force: true });
    markFusedAssemblySleeveShrunk(assemblyId, true);
    global.isSleeveShrunk = true;
    if (typeof window !== 'undefined') window.isSleeveShrunk = true;
    rebuildLayer();
    applyOvenSleeveShrinkVisual(assemblyId, 100);
    syncFusedAssemblyVisuals(assemblyId);
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    refreshBudget();
    setStatus('Heat-shrink complete · drag protected splice out of oven');
    return true;
  }

  function canStartOvenHeat(machineId) {
    var assemblyId = resolveFusionAssemblyId(machineId, { preferDocked: true });
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    return !!(
      asm &&
      asm.isOvenDocked &&
      asm.heatPhase === 'docked' &&
      !asm.sleeveShrunk &&
      fusedAssemblyHasShrinkSleeve(assemblyId)
    );
  }

  function memberSnappedToSplicer(p) {
    if (!p) return false;
    if (isCable(p)) return !!(p.isSnappedToSplicer || p.startIsSnappedToSplicer);
    return !!p.isSnappedToSplicer;
  }

  /** Fusion committed on this end but no longer seated in the splicer V-groove. */
  function isFusionEndLiftedFromSplicer(p, end) {
    if (!p) return false;
    end = resolveCableEnd(p, end);
    var asmId = getMemberEndFusionAssemblyId(p, end);
    if (!asmId || !fusedAssemblies[asmId]) return false;
    return !cableEndIsSnappedToSplicer(p, end);
  }

  function isMemberFusionLiftedFromSplicer(p) {
    if (!p) return false;
    if (isCable(p)) {
      return isFusionEndLiftedFromSplicer(p, 'start') ||
        isFusionEndLiftedFromSplicer(p, 'end');
    }
    return isFusionEndLiftedFromSplicer(p, 'end');
  }

  function shouldProtectFusionFieldsFromMachineClear(p, end) {
    if (!p) return false;
    end = resolveMemberEnd(p, end);
    if (isMemberEndFusionPermanent(p, end)) return true;
    return isFusionEndLiftedFromSplicer(p, end);
  }

  function clearMemberEndWeldFields(p, end) {
    if (!p) return;
    end = resolveCableEnd(p, end);
    if (end === 'start' && isCable(p)) {
      p.startSplicerWeldMachineId = null;
      p.startFusionAssemblyId = null;
      p.startFusedPartnerId = null;
      p.startFusedJacketEndDist = null;
      p.startSplicerFusedSide = null;
      return;
    }
    p.splicerWeldMachineId = null;
    p.fusionAssemblyId = null;
    p.fusedPartnerId = null;
    p.fusedJacketEndDist = null;
    p.splicerFusedSide = null;
  }

  function clearMemberEndFusionFields(p, end) {
    if (!p) return;
    end = resolveCableEnd(p, end);
    if (end === 'start' && isCable(p)) {
      p.startSplicerFusedSide = null;
      p.startFusedJacketEndDist = null;
      p.startFusionAssemblyId = null;
      p.startFusedPartnerId = null;
      p.startSplicerWeldMachineId = null;
      p.startFusionPermanent = false;
      p.startIsSleeveShrunk = false;
      return;
    }
    p.splicerFusedSide = null;
    p.fusedJacketEndDist = null;
    p.isOvenDocked = false;
    p.ovenDockMachineId = null;
    p.isSleeveShrunk = false;
    p.fusionPermanent = false;
    p.fusionAssemblyId = null;
    p.fusedPartnerId = null;
    p.splicerWeldMachineId = null;
  }

  function shouldRenderFusedBridgeInMainLayer(machineId) {
    if (!isFusedAssembly(machineId)) return false;
    var pair = getFusedAssemblyPigtails(machineId);
    if (!pair.left || !pair.right) return false;
    return !memberSnappedToSplicer(pair.left) && !memberSnappedToSplicer(pair.right);
  }

  function resolveFusedJacketEndDist(p, densePts, total, splicerSlot) {
    if (!p || !densePts || total < 0.01) return 0;
    if (isCable(p) && getCableFusedEnd(p) === 'start') {
      if (p.startFusedJacketEndDist != null && isFinite(p.startFusedJacketEndDist)) {
        return Math.max(0, Math.min(total,
          p.startFusedJacketEndDist + getSplicerExposedBareLengthPxForEnd(p, 'start')));
      }
      if (isPigtailFused(p) && !memberSnappedToSplicer(p)) {
        var weldProjStart = projectOntoFiberStrict(densePts, p.ax, p.ay);
        var bareLenStart = getSplicerExposedBareLengthPxForEnd(p, 'start');
        return Math.max(0, Math.min(total, (weldProjStart.dist || 0) + bareLenStart));
      }
    }
    if (isPigtailFused(p) && !memberSnappedToSplicer(p)) {
      var weldProj = projectOntoFiberStrict(densePts, p.bx, p.by);
      var bareLen = getSplicerExposedBareLengthPx(p);
      return Math.max(0, Math.min(total, (weldProj.dist || total) - bareLen));
    }
    if (p.fusedJacketEndDist != null && isFinite(p.fusedJacketEndDist)) {
      return Math.max(0, Math.min(total, p.fusedJacketEndDist));
    }
    if (isPigtailFused(p)) {
      return Math.max(0, total - getSplicerExposedBareLengthPx(p));
    }
    if (p.splicerInnerEdgeX != null && splicerSlot) {
      var innerProj = projectOntoFiberStrict(densePts, p.splicerInnerEdgeX, splicerSlot.grooveY);
      return Math.max(0, Math.min(total, innerProj.dist || 0));
    }
    if (p.splicerInnerEdgeX != null) {
      var grooveY = p.by;
      var innerProj2 = projectOntoFiberStrict(densePts, p.splicerInnerEdgeX, grooveY);
      return Math.max(0, Math.min(total, innerProj2.dist || 0));
    }
    return Math.max(0, total - getSplicerExposedBareLengthPx(p));
  }

  /** Jacket slice + exact endpoint — shared by jacket render and weld bridge. */
  function getFusedJacketSlicePoints(p) {
    var densePts = fiberRenderPathPointsDense(p);
    if (!densePts || densePts.length < 2) {
      return { densePts: densePts, jacketPts: [], end: null };
    }
    var total = polylineLength(densePts);
    var splicerSlot = null;
    if (p.snappedSplicerId && p.snappedSplicerSide) {
      splicerSlot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
    }
    var dJacketEnd = resolveFusedJacketEndDist(p, densePts, total, splicerSlot);
    var jacketPts = slicePolylineByDistance(densePts, 0, dJacketEnd);
    if (jacketPts.length < 2) {
      jacketPts = slicePolylineByDistance(densePts, 0, Math.max(dJacketEnd, 2));
    }
    var end = jacketPts.length ? jacketPts[jacketPts.length - 1] : null;
    return { densePts: densePts, jacketPts: jacketPts, end: end };
  }

  function getFusedJacketEndWorld(p) {
    var slice = getFusedJacketSlicePoints(p);
    if (!slice.end) return null;
    return { x: slice.end.x, y: slice.end.y };
  }

  function captureFusedJacketEndDist(p, machineId, side, cableEnd) {
    if (!p) return;
    cableEnd = cableEnd ? cableEndFromToken(cableEnd) : (isCable(p) ? resolveCableEnd(p, p.activeCableEnd) : 'end');
    var densePts = fiberRenderPathPointsDense(p);
    var total = polylineLength(densePts);
    var slot = getSplicerGrooveSlot(machineId, side, { forTracking: true });
    var dist = null;
    if (slot) {
      var innerProj = projectOntoFiberStrict(densePts, slot.innerEdgeX, slot.grooveY);
      dist = Math.max(0, Math.min(total, innerProj.dist || 0));
    } else if (isCable(p) && cableEnd === 'start' && p.startSplicerInnerEdgeX != null) {
      var startProj = projectOntoFiberStrict(densePts, p.startSplicerInnerEdgeX, p.ay);
      dist = Math.max(0, Math.min(total, startProj.dist || 0));
    } else if (p.splicerInnerEdgeX != null) {
      var grooveY = isCable(p) && cableEnd === 'start' ? p.ay : p.by;
      var fallback = projectOntoFiberStrict(densePts, p.splicerInnerEdgeX, grooveY);
      dist = Math.max(0, Math.min(total, fallback.dist || 0));
    }
    if (dist == null) return;
    if (isCable(p) && cableEnd === 'start') {
      p.startFusedJacketEndDist = dist;
    } else {
      p.fusedJacketEndDist = dist;
    }
  }

  /**
   * Bidirectional cable fusion slice — tip-anchored like buildCableEndStripSvg.
   * barePts always run jacket-boundary → cleaved tip (last point at weld) for glass merge.
   */
  function sliceCableFusedMemberAssemblyParts(p, fusedEnd, densePts, total) {
    fusedEnd = cableEndFromToken(fusedEnd || getCableFusedEnd(p));
    if (!p || !isCable(p) || !densePts || total < 0.01 || !fusedEnd) {
      return { jacketPts: [], barePts: [], dJacket: 0, fusedEnd: fusedEnd };
    }
    var bareRender = Math.max(
      cableEndRenderDistPx(p, fusedEnd, 'bare'),
      getSplicerExposedBareLengthPxForEnd(p, fusedEnd)
    );
    bareRender = Math.min(total, Math.max(bareRender, STRIP_TIP_EPS));
    var dJacketStub = Math.min(total, bareRender + CABLE_FUSION_JACKET_STUB_PX);
    var barePts;
    var jacketPts;
    var dJacket;
    if (fusedEnd === 'start') {
      barePts = slicePolylineByDistance(densePts, 0, bareRender);
      if (barePts.length >= 2) barePts = barePts.slice().reverse();
      jacketPts = slicePolylineByDistance(densePts, bareRender, dJacketStub);
      dJacket = bareRender;
    } else {
      var dBareStart = Math.max(0, total - bareRender);
      var dJacketStart = Math.max(0, total - dJacketStub);
      barePts = slicePolylineByDistance(densePts, dBareStart, total);
      jacketPts = slicePolylineByDistance(densePts, dJacketStart, dBareStart);
      dJacket = dBareStart;
    }
    return { jacketPts: jacketPts, barePts: barePts, dJacket: dJacket, fusedEnd: fusedEnd };
  }

  /** Unidirectional pigtail fusion slice — connector @ 0, weld tip @ total. */
  function sliceFusedMemberAssemblyParts(p, densePts, total) {
    if (!p || !densePts || total < 0.01) {
      return { jacketPts: [], barePts: [], dJacket: 0 };
    }
    var dJacket = resolveFusedJacketEndDist(p, densePts, total, null);
    return {
      jacketPts: slicePolylineByDistance(densePts, 0, dJacket),
      barePts: slicePolylineByDistance(densePts, dJacket, total),
      dJacket: dJacket,
    };
  }

  function purgeStaleFusedBareSegments(machineId) {
    if (!layer || !machineId) return;
    var pair = getFusedAssemblyPigtails(machineId);
    var asm = fusedAssemblies[machineId];
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      var selectors = [];
      if (isCable(pg)) {
        var fusedEnd = getCableFusedEnd(pg, asm);
        if (fusedEnd === 'start') {
          selectors.push(
            '[data-pt-fiber-stripped="' + pg.id + ':start"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="start"][data-pt-fiber-seg="bare"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="start"][data-pt-fiber-seg="jacket"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="start"][data-pt-fiber-seg="buffer"]',
            '[data-pt-residue="' + pg.id + ':start"]'
          );
        } else if (fusedEnd === 'end') {
          selectors.push(
            '[data-pt-fiber-stripped="' + pg.id + '"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="end"][data-pt-fiber-seg="bare"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="end"][data-pt-fiber-seg="jacket"]',
            '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-end="end"][data-pt-fiber-seg="buffer"]',
            '[data-pt-residue="' + pg.id + '"]'
          );
        }
      } else {
        selectors.push(
          '[data-pt-fiber-stripped="' + pg.id + '"]',
          '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-seg="bare"]',
          '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-seg="jacket"]',
          '[data-pt-residue="' + pg.id + '"]'
        );
      }
      if (!selectors.length) return;
      layer.querySelectorAll(selectors.join(',')).forEach(function (el) {
        if (el.closest('[data-fused-assembly]')) return;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    });
  }

  function removeFusedAssemblyFromSvg(svg, machineId) {
    if (!svg || !machineId) return;
    svg.querySelectorAll('[data-fused-assembly="' + machineId + '"]').forEach(function (el) {
      if (el.parentNode) el.parentNode.removeChild(el);
    });
  }

  function removeFusedBridgeFromSvg(svg, machineId) {
    removeFusedAssemblyFromSvg(svg, machineId);
  }

  function getFusedAssemblySliceData(machineId) {
    if (!isFusedAssembly(machineId)) return null;
    var pair = getFusedAssemblyPigtails(machineId);
    if (!pair.left || !pair.right) return null;
    var left = pair.left;
    var right = pair.right;
    var leftDense = fiberRenderPathPointsDense(left);
    var rightDense = fiberRenderPathPointsDense(right);
    if (!leftDense || leftDense.length < 2 || !rightDense || rightDense.length < 2) return null;
    var totalL = polylineLength(leftDense);
    var totalR = polylineLength(rightDense);
    var asm = fusedAssemblies[machineId];
    var fusedEndL = isCable(left) ? getCableFusedEnd(left, asm) : null;
    var fusedEndR = isCable(right) ? getCableFusedEnd(right, asm) : null;
    var sliceL = isCable(left)
      ? sliceCableFusedMemberAssemblyParts(left, fusedEndL, leftDense, totalL)
      : sliceFusedMemberAssemblyParts(left, leftDense, totalL);
    var sliceR = isCable(right)
      ? sliceCableFusedMemberAssemblyParts(right, fusedEndR, rightDense, totalR)
      : sliceFusedMemberAssemblyParts(right, rightDense, totalR);
    var jacketL = sliceL.jacketPts;
    var bareL = sliceL.barePts;
    var jacketR = sliceR.jacketPts;
    var bareR = sliceR.barePts;
    if (jacketL.length < 2) {
      if (isCable(left)) {
        if (fusedEndL === 'start') {
          jacketL = slicePolylineByDistance(leftDense, sliceL.dJacket, Math.min(totalL, sliceL.dJacket + 2));
        } else {
          jacketL = slicePolylineByDistance(leftDense, Math.max(0, totalL - CABLE_FUSION_JACKET_STUB_PX), sliceL.dJacket);
        }
      } else {
        jacketL = slicePolylineByDistance(leftDense, 0, Math.max(sliceL.dJacket, 2));
      }
    }
    if (jacketR.length < 2) {
      if (isCable(right)) {
        if (fusedEndR === 'start') {
          jacketR = slicePolylineByDistance(rightDense, sliceR.dJacket, Math.min(totalR, sliceR.dJacket + 2));
        } else {
          jacketR = slicePolylineByDistance(rightDense, Math.max(0, totalR - CABLE_FUSION_JACKET_STUB_PX), sliceR.dJacket);
        }
      } else {
        jacketR = slicePolylineByDistance(rightDense, 0, Math.max(sliceR.dJacket, 2));
      }
    }
    var weld = null;
    if (asm && asm.meetX != null && asm.bridgeY != null) {
      weld = { x: asm.meetX, y: asm.bridgeY };
    } else {
      var weldL = getFusedMemberWeldWorld(left, asm);
      var weldR = getFusedMemberWeldWorld(right, asm);
      if (weldL && weldR) {
        weld = { x: (weldL.x + weldR.x) / 2, y: (weldL.y + weldR.y) / 2 };
      } else {
        weld = weldL || weldR || { x: left.bx, y: left.by };
      }
    }
    return {
      left: left,
      right: right,
      jacketL: jacketL,
      bareL: bareL,
      jacketR: jacketR,
      bareR: bareR,
      weld: weld,
    };
  }

  function buildFusedGlassPathPoints(bareL, bareR) {
    var pts = (bareL || []).slice();
    if (!bareR || bareR.length < 2) return collapseOrthoPts(pts);
    var i;
    for (i = bareR.length - 2; i >= 0; i--) {
      pushSleevePathPt(pts, bareR[i]);
    }
    return collapseOrthoPts(pts);
  }

  /**
   * One bound group: L jacket + curved bare glass + R jacket, all from live path slices.
   */
  function buildFusedAssemblyUnifiedSvg(machineId, opts) {
    opts = opts || {};
    var data = getFusedAssemblySliceData(machineId);
    if (!data) return '';
    var asm = ensureFusedAssemblyOvenState(machineId);
    var left = data.left;
    var right = data.right;
    var jacketLPath = fiberSvgPathFromRenderPoints(left, data.jacketL);
    var jacketRPath = fiberSvgPathFromRenderPoints(right, data.jacketR);
    var glassPts = buildFusedGlassPathPoints(data.bareL, data.bareR);
    var channelJacketPath = '';
    var channelLaserPath = '';
    if (asm && asm.isOvenDocked && asm.ovenChannel) {
      var ch = asm.ovenChannel;
      channelJacketPath =
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket lab-fused-oven-channel-jacket" ' +
        'data-fused-asm-part="left-channel-jacket" data-fused-asm-id="' + machineId + '" ' +
        'd="M' + ch.x1 + ' ' + ch.cy + ' L' + ch.cx + ' ' + ch.cy + '" fill="none"' +
        jacketStrokeStyleAttr(left) + ' />' +
        '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket lab-fused-oven-channel-jacket" ' +
        'data-fused-asm-part="right-channel-jacket" data-fused-asm-id="' + machineId + '" ' +
        'd="M' + ch.cx + ' ' + ch.cy + ' L' + ch.x2 + ' ' + ch.cy + '" fill="none"' +
        jacketStrokeStyleAttr(right) + ' />';
      channelLaserPath =
        '<path class="lab-pigtail-laser-core lab-pigtail-laser-core--fused-channel" data-fused-laser="' + machineId + '" ' +
        'data-fused-laser-part="channel" d="M' + ch.x1 + ' ' + ch.cy + ' L' + ch.x2 + ' ' + ch.cy + '" fill="none" />';
    }
    if (glassPts.length < 2) {
      var endL = data.jacketL.length ? data.jacketL[data.jacketL.length - 1] : null;
      var endR = data.jacketR.length ? data.jacketR[data.jacketR.length - 1] : null;
      if (endL && endR) {
        glassPts = [{ x: endL.x, y: endL.y }, { x: endR.x, y: endR.y }];
      }
    }
    if (glassPts.length < 2) {
      var weldFb = data.weld;
      if (weldFb && isFinite(weldFb.x) && isFinite(weldFb.y)) {
        glassPts = [
          { x: weldFb.x - 2.5, y: weldFb.y },
          { x: weldFb.x + 2.5, y: weldFb.y },
        ];
      } else if (data.bareL && data.bareL.length) {
        var tipL = data.bareL[data.bareL.length - 1];
        var tipR = data.bareR && data.bareR.length ? data.bareR[0] : tipL;
        glassPts = [{ x: tipL.x, y: tipL.y }, { x: tipR.x, y: tipR.y }];
      }
    }
    if (glassPts.length < 2) {
      var wx = data.weld && isFinite(data.weld.x) ? data.weld.x : 0;
      var wy = data.weld && isFinite(data.weld.y) ? data.weld.y : 0;
      glassPts = [{ x: wx - 2.5, y: wy }, { x: wx + 2.5, y: wy }];
    }
    var glassPath = svgPathFromPoints(glassPts);
    var dragPts = data.jacketL.concat(glassPts.length > 1 ? glassPts.slice(1) : []);
    var revJacketR = data.jacketR.slice().reverse();
    if (revJacketR.length > 1) dragPts = dragPts.concat(revJacketR.slice(1));
    var dragD = svgPathFromPoints(collapseOrthoPts(dragPts));
    var badL = left.connector.mismatch;
    var badR = right.connector.mismatch;
    var selL = selection.id === left.id ? ' is-selected' : '';
    var selR = selection.id === right.id ? ' is-selected' : '';
    var splicerCls = opts.splicerPort ? ' is-splicer-terminated' : '';
    var ovenDockCls = asm && asm.isOvenDocked ? ' is-oven-docked' : '';
    var heatLockCls = asm && asm.heatPhase === 'heating' ? ' is-heat-locked' : '';
    var shrunkCls = asm && asm.sleeveShrunk ? ' is-sleeve-shrunk' : '';
    var open = opts.skipWrapper
      ? ''
      : '<g class="lab-splicer-fused-assembly' + ovenDockCls + heatLockCls + shrunkCls +
        '" data-fused-assembly="' + machineId + '">';
    var close = opts.skipWrapper ? '' : '</g>';
    return (
      open +
      '<path class="lab-pigtail-fiber-hit lab-fused-bridge-hit" data-fused-drag-bridge="' + machineId + '" ' +
        'd="' + dragD + '" fill="none" stroke="transparent" />' +
      '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (badL ? ' is-mismatch' : '') + selL + splicerCls +
        '" data-fused-asm-part="left-jacket" data-fused-asm-id="' + machineId + '" d="' +
        jacketLPath + '" fill="none"' + jacketStrokeStyleAttr(left) + ' />' +
      '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
        (badR ? ' is-mismatch' : '') + selR + splicerCls +
        '" data-fused-asm-part="right-jacket" data-fused-asm-id="' + machineId + '" d="' +
        jacketRPath + '" fill="none"' + jacketStrokeStyleAttr(right) + ' />' +
      channelJacketPath +
      '<path class="lab-pigtail-fiber lab-pigtail-fiber--bare lab-pigtail-fiber--bare-tip lab-pigtail-fiber--cleaved lab-splicer-fusion-bridge__glass" ' +
        'data-fusion-bridge="' + machineId + '" d="' + glassPath + '" fill="none" />' +
      '<circle class="lab-splicer-fusion-bridge__joint" cx="' + data.weld.x + '" cy="' + data.weld.y + '" r="2.4" />' +
      '<circle class="lab-splicer-fusion-bridge__joint-glow" cx="' + data.weld.x + '" cy="' + data.weld.y + '" r="5" />' +
      '<path class="lab-pigtail-laser-core lab-pigtail-laser-core--fused-jacket" data-fused-laser="' + machineId + '" ' +
        'data-fused-laser-part="left" d="' + jacketLPath + '" fill="none" />' +
      '<path class="lab-pigtail-laser-core lab-pigtail-laser-core--fused-bridge" data-fused-laser="' + machineId + '" ' +
        'data-fused-laser-part="bridge" d="' + glassPath + '" fill="none" />' +
      '<path class="lab-pigtail-laser-core lab-pigtail-laser-core--fused-jacket" data-fused-laser="' + machineId + '" ' +
        'data-fused-laser-part="right" d="' + jacketRPath + '" fill="none" />' +
      channelLaserPath +
      close
    );
  }

  function refreshFusedAssemblyInMainLayer(machineId) {
    if (!layer || !machineId || !isFusedAssembly(machineId)) return;
    var svg = layer.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    purgeStaleFusedBareSegments(machineId);
    removeFusedAssemblyFromSvg(svg, machineId);
    if (!shouldRenderFusedBridgeInMainLayer(machineId)) return;
    var assemblyHtml = buildFusedAssemblyUnifiedSvg(machineId);
    if (!assemblyHtml) return;
    var temp = document.createElement('div');
    temp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + assemblyHtml + '</svg>';
    var assemblyEl = temp.firstChild && temp.firstChild.firstChild;
    if (assemblyEl) svg.appendChild(assemblyEl);
    rebindDragGripsInRoot(svg);
    reapplyStoredVflGlow();
  }

  function refreshFusedBridgeInMainLayer(machineId) {
    refreshFusedAssemblyInMainLayer(machineId);
  }

  function rebindDragGripsInRoot(root) {
    if (!root) return;
    root.querySelectorAll('[data-pt-drag]').forEach(bindPigtailBodyDragGrip);
    root.querySelectorAll('[data-fused-drag-bridge]').forEach(bindFusedBridgeDragGrip);
  }

  function rebindFusedAssemblyDragGrips(machineId) {
    if (!machineId) return;
    if (layer) {
      var mainSvg = layer.querySelector('.lab-pigtail-svg');
      if (mainSvg) rebindDragGripsInRoot(mainSvg);
    }
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.ensureFiberLayer === 'function') {
      var host = FusionSplicerMachine.ensureFiberLayer(machineId);
      if (host) {
        var overlaySvg = host.querySelector('.lab-pigtail-svg');
        if (overlaySvg) rebindDragGripsInRoot(overlaySvg);
      }
    }
  }

  /** Real-time fused glass sync — call every drag frame and after path edits. */
  function syncFusedAssemblyVisuals(machineId) {
    if (!machineId || !isFusedAssembly(machineId)) return;
    refreshFusedAssemblyInMainLayer(machineId);
    renderSplicerFiberOverlays(machineId);
  }

  function getFusedBridgeGeometry(machineId) {
    if (!isFusedAssembly(machineId)) return null;
    var data = getFusedAssemblySliceData(machineId);
    if (!data) return null;
    var endL = data.jacketL.length ? data.jacketL[data.jacketL.length - 1] : null;
    var endR = data.jacketR.length ? data.jacketR[data.jacketR.length - 1] : null;
    if (!endL || !endR) return null;
    return {
      x1: endL.x,
      y1: endL.y,
      x2: endR.x,
      y2: endR.y,
      cx: data.weld.x,
      cy: data.weld.y,
    };
  }

  function renderFusedJacketSvg(p, opts) {
    opts = opts || {};
    var slice = getFusedJacketSlicePoints(p);
    var jacketPts = slice.jacketPts;
    if (!jacketPts || jacketPts.length < 2) {
      jacketPts = slice.densePts && slice.densePts.length >= 2
        ? slice.densePts.slice(0, 2)
        : [];
    }
    var bad = p.connector.mismatch;
    var sel = selection.id === p.id ? ' is-selected' : '';
    var splicerCls = opts.splicerPort ? ' is-splicer-terminated' : '';
    ensureFiberStrip(p);
    var fs = p.fiberStrip;
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    function peelStyle(layerName) {
      if (peel <= 0.02 || peelLayer !== layerName) return '';
      return ' style="--strip-peel:' + peel.toFixed(3) + ';"';
    }
    function peelClass(layerName) {
      return peel > 0.02 && peelLayer === layerName ? ' is-strip-peeling' : '';
    }
    return (
      '<path class="lab-pigtail-fiber lab-pigtail-fiber--jacket' +
      (bad ? ' is-mismatch' : '') + sel + peelClass('jacket') + splicerCls +
      '" data-pt-fiber="' + p.id + '" data-pt-fiber-seg="jacket" d="' +
      fiberSvgPathFromRenderPoints(p, jacketPts) + '" fill="none"' +
      jacketPathStyleAttr(p, 'jacket', peel, peelLayer) + ' />'
    );
  }

  function liftFusedAssemblyFromSplicer(machineId) {
    if (!isFusedAssembly(machineId)) return false;
    var pair = getFusedAssemblyPigtails(machineId);
    var lifted = false;
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      var ends = isCable(pg) ? ['start', 'end'] : ['end'];
      ends.forEach(function (end) {
        if (!cableEndIsSnappedToSplicer(pg, end)) return;
        clearSplicerSnap(pg, { skipRebuild: true, preserveWeld: true, end: end });
        if (end === 'start') pg.startSplicerDragDetached = true;
        else pg.splicerDragDetached = true;
        lifted = true;
      });
    });
    if (lifted) {
      renderSplicerFiberOverlays(machineId);
    }
    return lifted;
  }

  /** Closest cable terminal to pointer — drives body-drag fusion/magnet scope. */
  function resolveBodyDragActiveEnd(p, clientX, clientY) {
    if (!p || !isCable(p)) return 'end';
    var w = clientToWorld(clientX, clientY);
    return nearestCableEndAtWorld(p, w.x, w.y);
  }

  /** Fusion assembly on either cable end — body drag lifts/moves the whole welded chain. */
  function getCableAnyEndFusionAssemblyId(p) {
    if (!p || !isCable(p)) return null;
    return getMemberEndFusionAssemblyId(p, 'start') || getMemberEndFusionAssemblyId(p, 'end');
  }

  /**
   * Which terminal may use the splicer magnet during drag.
   * Prefers the handle or pointer-nearest end when free; otherwise the opposite free end (tip-probed).
   */
  function resolveSplicerMagnetDragTarget(p, clientX, clientY, handleEnd) {
    if (!p) return null;
    var active = handleEnd != null
      ? resolveMemberEnd(p, handleEnd)
      : (isCable(p)
        ? resolveBodyDragActiveEnd(p, clientX, clientY)
        : resolveMemberEnd(p, 'end'));
    if (!getMemberEndFusionAssemblyId(p, active)) {
      return { end: active, probeTip: false };
    }
    if (isCable(p)) {
      var other = otherCableEnd(active);
      if (!getMemberEndFusionAssemblyId(p, other)) {
        return { end: other, probeTip: true };
      }
    }
    return null;
  }

  function splicerDragProbeClientXY(p, end, clientX, clientY, probeTip) {
    if (!probeTip || !isCable(p)) return { x: clientX, y: clientY };
    var tip = cableEndTipWorld(p, end);
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.worldToClient === 'function') {
      return FusionSplicerMachine.worldToClient(tip.x, tip.y);
    }
    return { x: clientX, y: clientY };
  }

  function applySplicerMagnetDuringDragForTarget(p, clientX, clientY, handleEnd) {
    var target = resolveSplicerMagnetDragTarget(p, clientX, clientY, handleEnd);
    if (!target) return null;
    applySplicerMagnetDuringDrag(p, clientX, clientY, target.end, { probeTip: target.probeTip });
    return target;
  }

  function finishSplicerMagnetOnDropForTarget(p, clientX, clientY, handleEnd, knownTarget) {
    var target = knownTarget || resolveSplicerMagnetDragTarget(p, clientX, clientY, handleEnd);
    if (!target) return false;
    return finishSplicerMagnetOnDrop(p, clientX, clientY, target.end, { probeTip: target.probeTip });
  }

  /**
   * Collect every cable/pigtail and fusion assembly in the welded chain graph
   * reachable from memberId (both startFusionAssemblyId and fusionAssemblyId).
   */
  function collectFusedChainComponent(memberId, opts) {
    opts = opts || {};
    var excludeAsm = null;
    if (opts.excludeAssemblyIds && opts.excludeAssemblyIds.length) {
      excludeAsm = {};
      opts.excludeAssemblyIds.forEach(function (aid) {
        if (aid) excludeAsm[aid] = true;
      });
    }
    var memberMap = {};
    var assemblyMap = {};
    var pending = {};
    if (!memberId) return { members: memberMap, assemblyIds: [] };
    pending[memberId] = true;

    while (true) {
      var ids = Object.keys(pending);
      if (!ids.length) break;
      pending = {};
      ids.forEach(function (id) {
        var pg = findPigtail(id);
        if (!pg) return;
        memberMap[id] = pg;
        var ends = isCable(pg) ? ['start', 'end'] : ['end'];
        ends.forEach(function (end) {
          var asmId = getMemberEndFusionAssemblyId(pg, end);
          if (!asmId || assemblyMap[asmId]) return;
          if (excludeAsm && excludeAsm[asmId]) return;
          assemblyMap[asmId] = true;
          var pair = getFusedAssemblyPigtails(asmId);
          [pair.left, pair.right].forEach(function (m) {
            if (!m || memberMap[m.id]) return;
            pending[m.id] = true;
          });
        });
      });
    }
    return { members: memberMap, assemblyIds: Object.keys(assemblyMap) };
  }

  function createFusedChainDragSnapshot(memberId) {
    var comp = collectFusedChainComponent(memberId);
    var members = [];
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      ensurePathHistory(pg);
      members.push({
        id: id,
        oax: pg.ax,
        oay: pg.ay,
        obx: pg.bx,
        oby: pg.by,
        hist0: pg.pathHistory.map(function (pt) {
          return { x: pt.x, y: pt.y };
        }),
      });
    });
    var assemblies = [];
    comp.assemblyIds.forEach(function (asmId) {
      var asm = fusedAssemblies[asmId];
      if (!asm) return;
      assemblies.push({
        id: asmId,
        meetX: asm.meetX,
        bridgeY: asm.bridgeY,
        bridgeX1: asm.bridgeX1,
        bridgeX2: asm.bridgeX2,
      });
    });
    return {
      members: members,
      assemblies: assemblies,
      assemblyIds: comp.assemblyIds,
    };
  }

  function restoreFusedChainStripFrontiers(snapshot) {
    if (!snapshot || !snapshot.members) return;
    snapshot.members.forEach(function (snap) {
      var pg = findPigtail(snap.id);
      if (!pg) return;
      if (isCable(pg)) {
        restoreCableEndStripFrontier(pg, 'start');
        restoreCableEndStripFrontier(pg, 'end');
      } else if (isFullyStrippedPigtail(pg) || pg.stripFrontierLock) {
        restorePermanentStripFrontier(pg);
      }
    });
  }

  /** Rigid translate every member + joint in a welded chain by the same delta. */
  function applyFusedChainGroupTranslation(snapshot, dx, dy) {
    if (!snapshot) return;
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) return;
    var i;
    for (i = 0; i < snapshot.members.length; i++) {
      var snap = snapshot.members[i];
      var pg = findPigtail(snap.id);
      if (!pg) continue;
      pg.ax = snap.oax + dx;
      pg.ay = snap.oay + dy;
      pg.bx = snap.obx + dx;
      pg.by = snap.oby + dy;
      if (snap.hist0.length) {
        pg.pathHistory = snap.hist0.map(function (pt) {
          return { x: pt.x + dx, y: pt.y + dy };
        });
        syncPathAlias(pg);
      }
    }
    for (i = 0; i < snapshot.assemblies.length; i++) {
      var asmSnap = snapshot.assemblies[i];
      var asm = fusedAssemblies[asmSnap.id];
      if (!asm) continue;
      if (asmSnap.meetX != null && isFinite(asmSnap.meetX)) asm.meetX = asmSnap.meetX + dx;
      if (asmSnap.bridgeY != null && isFinite(asmSnap.bridgeY)) asm.bridgeY = asmSnap.bridgeY + dy;
      if (asmSnap.bridgeX1 != null && isFinite(asmSnap.bridgeX1)) asm.bridgeX1 = asmSnap.bridgeX1 + dx;
      if (asmSnap.bridgeX2 != null && isFinite(asmSnap.bridgeX2)) asm.bridgeX2 = asmSnap.bridgeX2 + dx;
    }
    restoreFusedChainStripFrontiers(snapshot);
    for (i = 0; i < snapshot.members.length; i++) {
      var memberSnap = snapshot.members[i];
      var member = findPigtail(memberSnap.id);
      if (!member) continue;
      updateFiberPath(member);
      repaintPigtailSleeveDom(member);
    }
  }

  function refreshFusedChainAfterPathEdits(snapshot, primaryAsmId) {
    if (!snapshot) return;
    snapshot.members.forEach(function (snap) {
      var pg = findPigtail(snap.id);
      if (!pg) return;
      syncPigtailFiberLength(pg);
      replacePigtailFiberSvg(pg, { skipFusedAssemblyRefresh: true });
      repaintPigtailSleeveDom(pg);
    });
    snapshot.assemblyIds.forEach(function (asmId) {
      syncFusedAssemblyVisuals(asmId);
    });
    if (document.body.classList.contains('lab-pigtail-dragging')) {
      var ovenAsm = primaryAsmId || (snapshot.assemblyIds.length ? snapshot.assemblyIds[0] : null);
      if (ovenAsm) {
        applyOvenMagnetDuringFusedDrag(ovenAsm, getFusionAssemblyMachineId(ovenAsm));
      }
    }
  }

  function liftFusedChainFromSplicer(memberId) {
    var comp = collectFusedChainComponent(memberId);
    comp.assemblyIds.forEach(function (asmId) {
      liftFusedAssemblyFromSplicer(asmId);
    });
  }

  function releaseFusedChainFromOven(memberId, opts) {
    var comp = collectFusedChainComponent(memberId);
    comp.assemblyIds.forEach(function (asmId) {
      if (isFusedAssemblyOvenDocked(asmId)) {
        releaseFusedAssemblyFromOven(asmId, opts);
      }
    });
  }

  function finishFusedChainDrag(snapshot) {
    if (!snapshot) return;
    snapshot.assemblyIds.forEach(function (asmId) {
      syncFusedAssemblyVisuals(asmId);
      rebindFusedAssemblyDragGrips(asmId);
    });
  }

  function beginFusedRigidDrag(p, clientX, clientY) {
    var activeEnd = resolveBodyDragActiveEnd(p, clientX, clientY);
    if (isCable(p)) p.activeCableEnd = activeEnd;
    var fusedAssemblyId = isCable(p)
      ? getCableAnyEndFusionAssemblyId(p)
      : (getMemberEndFusionAssemblyId(p, 'end') || getMemberEndFusionAssemblyId(p, 'start'));
    var chainSnapshot = fusedAssemblyId ? createFusedChainDragSnapshot(p.id) : null;
    if (fusedAssemblyId && !isFusedAssemblyHeatLocked(fusedAssemblyId)) {
      if (isFusedAssemblyOvenDocked(fusedAssemblyId)) {
        releaseFusedChainFromOven(p.id, {
          preserveShrink: isFusedAssemblySleeveShrunk(fusedAssemblyId),
        });
      } else {
        liftFusedChainFromSplicer(p.id);
      }
    } else if (isCable(p)) {
      ['start', 'end'].forEach(function (cableEnd) {
        if (cableEndIsSnappedToCleaver(p, cableEnd)) {
          clearCleaverSnap(p, { skipGuide: true, end: cableEnd });
        } else if (cableEndIsSnappedToSplicer(p, cableEnd)) {
          forceUnsnapPigtailFromSplicer(p, cableEnd);
        } else {
          restoreCableEndStripFrontier(p, cableEnd);
        }
      });
    } else if (p.isSnappedToCleaver) {
      clearCleaverSnap(p, { skipGuide: true });
    } else if (p.isSnappedToSplicer) {
      forceUnsnapPigtailFromSplicer(p, 'end');
    } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
    }
    ensurePathHistory(p);
    return {
      w0: clientToWorld(clientX, clientY),
      oax: p.ax,
      oay: p.ay,
      obx: p.bx,
      oby: p.by,
      hist0: p.pathHistory.map(function (pt) {
        return { x: pt.x, y: pt.y };
      }),
      activeEnd: activeEnd,
      fusedMachineId: fusedAssemblyId,
      splicerMachineId: fusedAssemblyId
        ? (getFusionAssemblyMachineId(fusedAssemblyId) ||
          getMemberEndSplicerWeldMachineId(p, activeEnd) ||
          getMemberEndSplicerWeldMachineId(p, otherCableEnd(activeEnd)))
        : getMemberEndSplicerWeldMachineId(p, activeEnd),
      chainSnapshot: chainSnapshot,
    };
  }

  function applyFusedRigidDrag(p, ctx, clientX, clientY) {
    if (ctx.fusedMachineId && isPigtailOvenDragLocked(p, ctx.activeEnd)) return;
    var w = clientToWorld(clientX, clientY);
    var dx = w.x - ctx.w0.x;
    var dy = w.y - ctx.w0.y;
    if (ctx.chainSnapshot) {
      applyFusedChainGroupTranslation(ctx.chainSnapshot, dx, dy);
      refreshFusedChainAfterPathEdits(ctx.chainSnapshot, ctx.fusedMachineId);
      return;
    }
    p.ax = ctx.oax + dx;
    p.ay = ctx.oay + dy;
    p.bx = ctx.obx + dx;
    p.by = ctx.oby + dy;
    if (ctx.hist0.length) {
      p.pathHistory = ctx.hist0.map(function (pt) {
        return { x: pt.x + dx, y: pt.y + dy };
      });
      syncPathAlias(p);
    }
    if (isCable(p)) {
      restoreCableEndStripFrontier(p, 'start');
      restoreCableEndStripFrontier(p, 'end');
    } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
    }
    updateFiberPath(p);
    if (ctx.fusedMachineId) {
      syncFusedAssemblyVisuals(ctx.fusedMachineId);
      var splicerMid = ctx.splicerMachineId || getFusionAssemblyMachineId(ctx.fusedMachineId);
      if (splicerMid) applyOvenMagnetDuringFusedDrag(ctx.fusedMachineId, splicerMid);
    }
  }

  function finishFusedRigidDrag(p, ctx) {
    if (!ctx || !ctx.fusedMachineId) return;
    if (ctx.chainSnapshot) finishFusedChainDrag(ctx.chainSnapshot);
    else syncFusedAssemblyVisuals(ctx.fusedMachineId);
  }

  function getFusedDragContext(p, end) {
    end = resolveMemberEnd(p, end);
    var asmId = getMemberEndFusionAssemblyId(p, end);
    if (!asmId) {
      return { machineId: null, splicerMachineId: null, partner: null, end: end };
    }
    return {
      machineId: asmId,
      splicerMachineId: getMemberEndSplicerWeldMachineId(p, end) ||
        getFusionAssemblyMachineId(asmId),
      partner: getFusedPartnerForEnd(p, end),
      end: end,
    };
  }

  function beginFusedEndDrag(p, end, clientX, clientY) {
    end = resolveMemberEnd(p, end);
    var ctx = getFusedDragContext(p, end);
    if (ctx.machineId) {
      ctx.chainSnapshot = createFusedChainDragSnapshot(p.id);
      if (typeof clientX === 'number' && typeof clientY === 'number') {
        ctx.w0 = clientToWorld(clientX, clientY);
      }
      if (!isFusedAssemblyHeatLocked(ctx.machineId)) {
        if (isFusedAssemblyOvenDocked(ctx.machineId)) {
          releaseFusedChainFromOven(p.id, {
            preserveShrink: isFusedAssemblySleeveShrunk(ctx.machineId),
          });
        } else {
          liftFusedChainFromSplicer(p.id);
        }
      }
      return ctx;
    }
    if (isCable(p)) {
      if (cableEndIsSnappedToCleaver(p, end)) {
        clearCleaverSnap(p, { skipGuide: true, end: end });
      } else if (cableEndIsSnappedToSplicer(p, end)) {
        forceUnsnapPigtailFromSplicer(p, end);
      } else {
        restoreCableEndStripFrontier(p, end);
      }
      return ctx;
    }
    if (end === 'end') {
      if (p.isSnappedToCleaver) {
        clearCleaverSnap(p, { skipGuide: true });
      } else if (p.isSnappedToSplicer) {
        forceUnsnapPigtailFromSplicer(p, 'end');
      } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
        restorePermanentStripFrontier(p);
      }
    }
    return ctx;
  }

  function setFusedAssemblyDragPassthrough(p, active, end) {
    var comp = collectFusedChainComponent(p.id);
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      if (pg) setPigtailDragPassthrough(pg, active);
    });
  }

  function isDraggingFusedWeldedEnd(p, draggedEnd) {
    if (!p) return false;
    draggedEnd = resolveMemberEnd(p, draggedEnd);
    if (!isMemberEndFused(p, draggedEnd)) return false;
    if (!isCable(p)) return draggedEnd === 'end';
    return true;
  }

  function setFusedMemberWeldTipWorld(p, weldX, weldY, asm) {
    if (!p || weldX == null || weldY == null) return;
    if (isCable(p) && getCableFusedEnd(p, asm) === 'start') {
      p.ax = weldX;
      p.ay = weldY;
      return;
    }
    p.bx = weldX;
    p.by = weldY;
  }

  function syncFusedPartnerWeldTip(primary, partner, end) {
    if (!primary || !partner) return;
    end = resolveMemberEnd(primary, end);
    var asmId = getMemberEndFusionAssemblyId(primary, end);
    var asm = asmId ? fusedAssemblies[asmId] : null;
    var weld = getFusedMemberWeldWorld(primary, asm);
    if (!weld) return;
    setFusedMemberWeldTipWorld(partner, weld.x, weld.y, asm);
  }

  /** Keep weld junction aligned after snake/gravity end drags on a fused pair. */
  function afterFusedEndDragFrame(primary, partner, machineId, draggedEnd) {
    if (!machineId || !primary) return;
    if (partner && isDraggingFusedWeldedEnd(primary, draggedEnd)) {
      syncFusedPartnerWeldTip(primary, partner, draggedEnd);
      if (isFullyStrippedPigtail(partner) || partner.stripFrontierLock) {
        restorePermanentStripFrontier(partner);
      }
    }
  }

  function refreshFusedAssemblyAfterPathEdits(primary, partner, machineId) {
    if (!machineId || !primary) return;
    syncPigtailFiberLength(primary);
    if (partner) syncPigtailFiberLength(partner);
    replacePigtailFiberSvg(primary, { skipFusedAssemblyRefresh: true });
    if (partner) replacePigtailFiberSvg(partner, { skipFusedAssemblyRefresh: true });
    var aBtn = layer && layer.querySelector('[data-pt-id="' + primary.id + '"][data-pt-end="A"]');
    var bBtn = layer && layer.querySelector('[data-pt-id="' + primary.id + '"][data-pt-end="B"]');
    if (aBtn) aBtn.setAttribute('style', connectorStyle(primary));
    if (bBtn) bBtn.setAttribute('style', tailStyle(primary) + ';--strip-peel:' + (primary.stripPeel || 0).toFixed(3) + ';');
    if (partner) {
      aBtn = layer && layer.querySelector('[data-pt-id="' + partner.id + '"][data-pt-end="A"]');
      bBtn = layer && layer.querySelector('[data-pt-id="' + partner.id + '"][data-pt-end="B"]');
      if (aBtn) aBtn.setAttribute('style', connectorStyle(partner));
      if (bBtn) bBtn.setAttribute('style', tailStyle(partner) + ';--strip-peel:' + (partner.stripPeel || 0).toFixed(3) + ';');
    }
    repaintPigtailSleeveDom(primary);
    if (partner) repaintPigtailSleeveDom(partner);
    syncFusedAssemblyVisuals(machineId);
    if (document.body.classList.contains('lab-pigtail-dragging')) {
      applyOvenMagnetDuringFusedDrag(
        machineId,
        getFusionAssemblyMachineId(machineId)
      );
    }
  }

  function finishFusedEndDrag(machineId, chainSnapshot) {
    if (chainSnapshot) {
      finishFusedChainDrag(chainSnapshot);
      return;
    }
    if (!machineId) return;
    syncFusedAssemblyVisuals(machineId);
    rebindFusedAssemblyDragGrips(machineId);
  }

  function isSplicerWeldedPair(machineId) {
    var pair = getSplicerDockedPair(machineId);
    if (!pair.left || !pair.right) return false;
    var leftReal = resolveDockedMember(pair.left);
    var rightReal = resolveDockedMember(pair.right);
    var leftEnd = dockedMemberCableEnd(pair.left);
    var rightEnd = dockedMemberCableEnd(pair.right);
    var assemblyId = leftReal && getMemberEndFusionAssemblyId(leftReal, leftEnd);
    if (!assemblyId || !isFusedAssembly(assemblyId)) return false;
    if (!rightReal || getMemberEndFusionAssemblyId(rightReal, rightEnd) !== assemblyId) {
      return false;
    }
    var fused = getFusedAssemblyPigtails(assemblyId);
    return !!(fused.left && fused.right &&
      fused.left.id === pair.left.id && fused.right.id === pair.right.id);
  }

  function captureSplicerDockSnapshot(p, end) {
    if (!p) return;
    end = resolveMemberEnd(p, end);
    var fs = isCable(p) ? ensureCableEndStrip(p, end) : ensureFiberStrip(p);
    var snap = {
      jacketTo: fs.jacketTo,
      bareTo: fs.bareTo,
      peel: fs.peel,
      peelLayer: fs.peelLayer,
    };
    if (isCable(p) && end === 'start') p.startSplicerDockSnapshot = snap;
    else p.splicerDockSnapshot = snap;
  }

  /** Restore strip arc-lengths captured before docking — never clamp-truncate after unsnap. */
  function restoreSplicerDockStripState(p, end) {
    if (!p) return;
    end = resolveMemberEnd(p, end);
    var snap = (isCable(p) && end === 'start') ? p.startSplicerDockSnapshot : p.splicerDockSnapshot;
    if (!snap) return;
    var fs = isCable(p) ? ensureCableEndStrip(p, end) : ensureFiberStrip(p);
    fs.jacketTo = snap.jacketTo;
    fs.bareTo = snap.bareTo;
    fs.peel = snap.peel;
    fs.peelLayer = snap.peelLayer;
    if (isCable(p) && end === 'start') p.startSplicerDockSnapshot = null;
    else p.splicerDockSnapshot = null;
    if (isCable(p)) {
      restoreCableEndStripFrontier(p, end);
      return;
    }
    enforceFullStripBareFrontier(p);
    if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
      restorePermanentStripFrontier(p);
    }
  }

  function clearSplicerWeldForMachine(machineId) {
    if (!machineId) return;
    pigtails.forEach(function (p) {
      if (isCable(p)) {
        ['start', 'end'].forEach(function (end) {
          if (isMemberEndFusionPermanent(p, end)) return;
          var weldedOn = end === 'start' ? p.startSplicerWeldMachineId : p.splicerWeldMachineId;
          if (weldedOn !== machineId) return;
          if (shouldProtectFusionFieldsFromMachineClear(p, end)) return;
          clearMemberEndWeldFields(p, end);
        });
        return;
      }
      if (isMemberEndFusionPermanent(p, 'end')) return;
      if (p.splicerWeldMachineId !== machineId) return;
      if (shouldProtectFusionFieldsFromMachineClear(p, 'end')) return;
      clearMemberEndWeldFields(p, 'end');
    });
  }

  /**
   * Slide docked member (and its welded chain, minus excluded assemblies) so the weld
   * tip lands at (meetX, grooveY) without pivoting the far anchor or path history.
   */
  function shiftMemberRigidToWeldMeet(p, dockRef, meetX, grooveY, excludeAssemblyIds) {
    if (!p || meetX == null || grooveY == null) return false;
    var end = dockedMemberCableEnd(dockRef);
    var tip = cableEndTipWorld(p, end);
    if (!tip) return false;
    var targetX = Math.round(meetX);
    var targetY = Math.round(grooveY);
    var dx = targetX - tip.x;
    var dy = targetY - tip.y;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return false;
    translateFusedChainRigid(p.id, dx, dy, { excludeAssemblyIds: excludeAssemblyIds });
    return true;
  }

  /** Fusion assembly id for the pair currently docked in L/R — never a prior chain joint. */
  function resolveSplicerDockWeldAssemblyId(dockPair, machineId) {
    if (!dockPair || !dockPair.left || !dockPair.right) return null;
    var weldId = makeFusionAssemblyId(dockPair.left.id, dockPair.right.id);
    if (weldId && isFusedAssembly(weldId)) return weldId;
    var byMachine = resolveFusionAssemblyIdForMachine(machineId);
    if (byMachine && isFusedAssembly(byMachine)) {
      var ap = getFusedAssemblyPigtails(byMachine);
      if (ap.left && ap.right &&
          ap.left.id === dockPair.left.id && ap.right.id === dockPair.right.id) {
        return byMachine;
      }
    }
    return weldId;
  }

  function syncSplicerWeldedTips(machineId) {
    var pair = getSplicerDockedPair(machineId);
    if (!pair.left || !pair.right) return false;
    var leftReal = resolveDockedMember(pair.left);
    var rightReal = resolveDockedMember(pair.right);
    var weldAssemblyId = resolveSplicerDockWeldAssemblyId(pair, machineId);
    var docked = (leftReal && memberSnappedToSplicer(leftReal)) ||
      (rightReal && memberSnappedToSplicer(rightReal));
    if (!docked) return true;
    var slotL = getSplicerGrooveSlot(machineId, 'L', { forTracking: true });
    var slotR = getSplicerGrooveSlot(machineId, 'R', { forTracking: true });
    if (slotL && slotR) {
      if (weldAssemblyId && isFusedAssembly(weldAssemblyId)) {
        updateFusedAssemblyBridgeFromSlots(weldAssemblyId, slotL, slotR);
      }
      if (leftReal) {
        if (dockedMemberCableEnd(pair.left) === 'start') {
          leftReal.startSplicerInnerEdgeX = slotL.innerEdgeX;
        } else {
          leftReal.splicerInnerEdgeX = slotL.innerEdgeX;
        }
      }
      if (rightReal) {
        if (dockedMemberCableEnd(pair.right) === 'start') {
          rightReal.startSplicerInnerEdgeX = slotR.innerEdgeX;
        } else {
          rightReal.splicerInnerEdgeX = slotR.innerEdgeX;
        }
      }
      var asm = weldAssemblyId ? fusedAssemblies[weldAssemblyId] : null;
      var meetX = asm ? asm.meetX : (slotL.innerEdgeX + slotR.innerEdgeX) / 2;
      var grooveY = asm ? asm.bridgeY : (slotL.grooveY + slotR.grooveY) / 2;
      /* Exclude only this splicer's new weld — never upstream chain assemblies. */
      var excludeWeldAsm = weldAssemblyId ? [weldAssemblyId] : [];
      shiftMemberRigidToWeldMeet(leftReal, pair.left, meetX, grooveY, excludeWeldAsm);
      shiftMemberRigidToWeldMeet(rightReal, pair.right, meetX, grooveY, excludeWeldAsm);
    }
    return true;
  }

  function applySplicerArcWeld(machineId) {
    var pair = getSplicerDockedPair(machineId);
    if (!pair.left || !pair.right) return false;
    var leftReal = resolveDockedMember(pair.left);
    var rightReal = resolveDockedMember(pair.right);
    var leftEnd = dockedMemberCableEnd(pair.left);
    var rightEnd = dockedMemberCableEnd(pair.right);
    if ((leftReal && isMemberEndFusionPermanent(leftReal, leftEnd)) ||
        (rightReal && isMemberEndFusionPermanent(rightReal, rightEnd))) {
      return false;
    }
    var fusionId = makeFusionAssemblyId(pair.left.id, pair.right.id);
    applyFusionStateToMember(pair.left, fusionId, machineId, 'L', pair.right.id);
    applyFusionStateToMember(pair.right, fusionId, machineId, 'R', pair.left.id);
    syncSplicerWeldedTips(machineId);
    return true;
  }

  function buildSplicerFusionBridgeSvg(machineId) {
    return buildFusedAssemblyUnifiedSvg(machineId);
  }

  /** Arc-weld complete — merge tips, bridge SVG, seal overlay layer. */
  function fuseSplicerFibers(machineId, opts) {
    opts = opts || {};
    if (!machineId) return false;
    if (!applySplicerArcWeld(machineId)) return false;
    registerFusedAssembly(machineId, opts);
    renderSplicerFiberOverlays(machineId);
    rebuildLayer();
    rebindFusedAssemblyDragGrips(machineId);
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    refreshBudget();
    return true;
  }

  function clearSplicerFusionVisual(machineId) {
    if (machineId) {
      var docked = getSplicerDockedPair(machineId);
      if (docked.left && docked.right) {
        var leftReal = resolveDockedMember(docked.left);
        var rightReal = resolveDockedMember(docked.right);
        var inChamber = leftReal && rightReal &&
          memberSnappedToSplicer(leftReal) && memberSnappedToSplicer(rightReal);
        if (inChamber) {
          var fusionId = makeFusionAssemblyId(docked.left.id, docked.right.id);
          if (fusionId &&
              !isMemberEndFusionPermanent(leftReal, dockedMemberCableEnd(docked.left)) &&
              !isMemberEndFusionPermanent(rightReal, dockedMemberCableEnd(docked.right))) {
            clearFusedAssembly(fusionId);
          }
        }
      }
      clearSplicerWeldForMachine(machineId);
    }
    if (machineId && global.FusionSplicerMachine && typeof FusionSplicerMachine.ensureFiberLayer === 'function') {
      var host = FusionSplicerMachine.ensureFiberLayer(machineId);
      if (host) host.removeAttribute('data-fusion-fiber-sealed');
    }
    if (machineId) {
      renderSplicerFiberOverlays(machineId);
      refreshSplicerDocks(machineId);
      rebuildLayer();
    }
  }

  /** Rigid-body shift — entire pigtail (connector, route, tip) moves as one unit. */
  function translatePigtailRigid(p, deltaX, deltaY) {
    if (!p) return;
    var dx = deltaX || 0;
    var dy = deltaY || 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
    p.ax += dx;
    p.ay += dy;
    p.bx += dx;
    p.by += dy;
    var hist = ensurePathHistory(p);
    var i;
    for (i = 0; i < hist.length; i++) {
      hist[i].x += dx;
      hist[i].y += dy;
    }
    syncPathAlias(p);
  }

  function translatePigtailRigidY(p, deltaY) {
    translatePigtailRigid(p, 0, deltaY);
  }

  /** Rigid translate every member + fusion joint reachable from memberId (splicer dock / live sync). */
  function translateFusedChainRigid(memberId, deltaX, deltaY, opts) {
    opts = opts || {};
    var dx = deltaX || 0;
    var dy = deltaY || 0;
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return null;
    var comp = collectFusedChainComponent(memberId, opts);
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      if (pg) translatePigtailRigid(pg, dx, dy);
    });
    comp.assemblyIds.forEach(function (asmId) {
      var asm = fusedAssemblies[asmId];
      if (!asm) return;
      if (asm.meetX != null && isFinite(asm.meetX)) asm.meetX += dx;
      if (asm.bridgeY != null && isFinite(asm.bridgeY)) asm.bridgeY += dy;
      if (asm.bridgeX1 != null && isFinite(asm.bridgeX1)) asm.bridgeX1 += dx;
      if (asm.bridgeX2 != null && isFinite(asm.bridgeX2)) asm.bridgeX2 += dx;
    });
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      if (!pg) return;
      if (isCable(pg)) {
        restoreCableEndStripFrontier(pg, 'start');
        restoreCableEndStripFrontier(pg, 'end');
      } else if (isFullyStrippedPigtail(pg) || pg.stripFrontierLock) {
        restorePermanentStripFrontier(pg);
      }
    });
    return comp;
  }

  function refreshFusedChainMembersAfterRigidShift(memberId) {
    var comp = collectFusedChainComponent(memberId);
    Object.keys(comp.members).forEach(function (id) {
      var pg = comp.members[id];
      if (pg) updateFiberPath(pg);
    });
    comp.assemblyIds.forEach(function (asmId) {
      syncFusedAssemblyVisuals(asmId);
    });
  }

  /**
   * Docked tip alignment — per-side only. Never mutates strip arc-lengths (clamp truncation
   * is geometric in buildPigtailFiberSvg). Cleaved fibers use exact cleavedGlassLength.
   */
  function alignSplicerJacketToInnerEdge(p, slot, end) {
    if (!p || !slot) return false;
    end = resolveCableEnd(p, end);
    var dir = slot.side === 'L' ? 1 : -1;
    var welded = isMemberEndFused(p, end);
    if (welded && cableEndIsSnappedToSplicer(p, end)) {
      syncSplicerWeldedTips(slot.machineId);
      return true;
    }
    if (welded) return true;
    var exposed = getSplicerExposedBareLengthPxForEnd(p, end);
    if (end === 'start') {
      p.ax = Math.round(slot.innerEdgeX + dir * exposed);
      p.ay = Math.round(slot.grooveY);
      p.startSplicerBareGlassPx = exposed;
      p.startSplicerInnerEdgeX = slot.innerEdgeX;
    } else {
      p.bx = Math.round(slot.innerEdgeX + dir * exposed);
      p.by = Math.round(slot.grooveY);
      p.splicerBareGlassPx = exposed;
      p.splicerInnerEdgeX = slot.innerEdgeX;
    }
    return true;
  }

  /** Shift whole member vertically so docked tip Y aligns with groove — no stretch, no diagonal bridge. */
  function applySplicerRigidSnapShift(p, slot, end) {
    if (!p || !slot) return false;
    end = resolveCableEnd(p, end);
    var tip = cableEndTipWorld(p, end);
    var deltaY = slot.grooveY - tip.y;
    if (Math.abs(deltaY) > 0.01) {
      translateFusedChainRigid(p.id, 0, deltaY);
    }
    if (end === 'start') p.ay = Math.round(slot.grooveY);
    else p.by = Math.round(slot.grooveY);
    return true;
  }

  var splicerDockTrackRafId = null;

  function syncSnappedPigtailToLiveGroove(p, end) {
    end = resolveCableEnd(p, end);
    if (!p || !cableEndIsSnappedToSplicer(p, end)) return false;
    var machineId = end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
    var side = end === 'start' ? p.startSnappedSplicerSide : p.snappedSplicerSide;
    var slot = getSplicerGrooveSlot(machineId, side, { forTracking: true });
    if (!slot) return false;
    var anchor = end === 'start' ? p.startSplicerGrooveAnchor : p.splicerGrooveAnchor;
    var changed = false;
    if (!anchor) {
      anchor = { x: slot.centerX, y: slot.grooveY };
      if (end === 'start') {
        p.startSplicerGrooveAnchor = anchor;
        p.startSplicerGrooveY = slot.grooveY;
      } else {
        p.splicerGrooveAnchor = anchor;
        p.splicerGrooveY = slot.grooveY;
      }
    } else {
      var deltaX = slot.centerX - anchor.x;
      var deltaY = slot.grooveY - anchor.y;
      if (Math.abs(deltaX) >= 0.01 || Math.abs(deltaY) >= 0.01) {
        translateFusedChainRigid(p.id, deltaX, deltaY);
        changed = true;
        anchor = { x: slot.centerX, y: slot.grooveY };
        if (end === 'start') {
          p.startSplicerGrooveAnchor = anchor;
          p.startSplicerGrooveY = slot.grooveY;
        } else {
          p.splicerGrooveAnchor = anchor;
          p.splicerGrooveY = slot.grooveY;
        }
      }
    }
    var innerEdgeX = end === 'start' ? p.startSplicerInnerEdgeX : p.splicerInnerEdgeX;
    var innerDrift = innerEdgeX == null || Math.abs(innerEdgeX - slot.innerEdgeX) > 0.5;
    if (changed || innerDrift) {
      alignSplicerJacketToInnerEdge(p, slot, end);
      changed = true;
    }
    if (changed) {
      refreshFusedChainMembersAfterRigidShift(p.id);
    }
    return changed;
  }

  function splicerDockTrackTick() {
    var anySnapped = false;
    var changed = false;
    var machineIds = {};
    pigtails.forEach(function (p) {
      var ends = isCable(p) ? ['start', 'end'] : ['end'];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!cableEndIsSnappedToSplicer(p, end)) continue;
        anySnapped = true;
        var mid = end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
        if (mid) machineIds[mid] = true;
        if (syncSnappedPigtailToLiveGroove(p, end)) {
          changed = true;
        }
      }
    });
    if (changed) {
      Object.keys(machineIds).forEach(function (mid) {
        renderSplicerFiberOverlays(mid);
      });
      if (layer) rebuildLayer();
    }
    if (anySnapped) {
      splicerDockTrackRafId = requestAnimationFrame(splicerDockTrackTick);
    } else {
      splicerDockTrackRafId = null;
    }
  }

  function ensureSplicerDockTracking() {
    if (splicerDockTrackRafId != null) return;
    splicerDockTrackRafId = requestAnimationFrame(splicerDockTrackTick);
  }

  function stopSplicerDockTracking() {
    if (splicerDockTrackRafId != null) {
      cancelAnimationFrame(splicerDockTrackRafId);
      splicerDockTrackRafId = null;
    }
  }

  function seatFiberInSplicerGroove(p, slot, opts) {
    opts = opts || {};
    if (!p || !slot || !slot.open) return false;
    var end = resolveCableEnd(p, opts.end);
    p.activeCableEnd = end;
    if (!splicerEligibleForSnap(p, end) && !opts.force) return false;
    var occupant = findSnappedPigtailOnSide(slot.machineId, slot.side, p.id, end);
    if (occupant) return false;

    captureSplicerDockSnapshot(p, end);
    applySplicerRigidSnapShift(p, slot, end);
    alignSplicerJacketToInnerEdge(p, slot, end);
    setCableEndSplicerSnap(p, end, slot);

    if (global.FusionSplicerMachine && global.FusionSplicerMachine.getUI) {
      var api = FusionSplicerMachine.getUI(slot.machineId);
      if (api && typeof api.setFiberPlaced === 'function') {
        api.setFiberPlaced(slot.side, true);
      }
    }

    if (!opts.quiet) {
      setStatus((isCable(p) ? 'Cable' : 'SC Pigtail') + ' · ' + end +
        ' end seated in ' + slot.side + '-clamp V-groove');
    }
    ensureSplicerDockTracking();
    return true;
  }

  function clearSplicerSnap(p, opts) {
    opts = opts || {};
    if (!p) return;
    var end = resolveCableEnd(p, opts.end);
    if (!cableEndIsSnappedToSplicer(p, end)) return;
    var machineId = end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
    var preserveWeld = !!opts.preserveWeld || isMemberEndFused(p, end);
    clearCableEndSplicerSnap(p, end, { preserveWeld: preserveWeld });
    restoreSplicerDockStripState(p, end);
    if (machineId && !preserveWeld) {
      clearSplicerWeldForMachine(machineId);
    }
    if (machineId) {
      renderSplicerFiberOverlays(machineId);
      if (!opts.skipRebuild && global.FusionSplicerMachine && FusionSplicerMachine.syncLidOverlays) {
        FusionSplicerMachine.syncLidOverlays(machineId);
      }
    }
  }

  /** Instant unsnap — detach machine slot, keep current geometry (shifted pathHistory + curves). */
  function forceUnsnapPigtailFromSplicer(p, end) {
    end = resolveCableEnd(p, end);
    if (!p || !cableEndIsSnappedToSplicer(p, end)) return false;
    if (isMemberEndFused(p, end)) {
      return liftFusedAssemblyFromSplicer(getMemberEndFusionAssemblyId(p, end));
    }
    clearSplicerSnap(p, { skipRebuild: true, end: end });
    if (end === 'start') p.startSplicerDragDetached = true;
    else p.splicerDragDetached = true;
    updateFiberPath(p);
    return true;
  }

  /** Pointer → silver `.clamp-base-groove` via elementFromPoint (no radius math). */
  function hitTestSplicerGroove(clientX, clientY) {
    if (!global.FusionSplicerMachine ||
        typeof FusionSplicerMachine.hitTestSplicerGrooveAtClient !== 'function') {
      return null;
    }
    return FusionSplicerMachine.hitTestSplicerGrooveAtClient(clientX, clientY);
  }

  function setPigtailDragPassthrough(p, active) {
    if (!p) return;
    var selector = '[data-pt-drag="' + p.id + '"]';
    if (layer) {
      layer.querySelectorAll(selector).forEach(function (el) {
        el.classList.toggle('is-drag-passthrough', !!active);
        el.style.pointerEvents = active ? 'none' : '';
      });
      layer.querySelectorAll('[data-pt-fiber="' + p.id + '"]').forEach(function (el) {
        el.style.pointerEvents = active ? 'none' : '';
      });
    }
    document.querySelectorAll('.lab-fusion-fiber-layer ' + selector).forEach(function (el) {
      el.classList.toggle('is-drag-passthrough', !!active);
      el.style.pointerEvents = active ? 'none' : '';
    });
  }

  function highlightSplicerGrooveHit(hit) {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.highlightSplicerGroove === 'function') {
      FusionSplicerMachine.highlightSplicerGroove(hit && hit.grooveEl ? hit.grooveEl : null);
      return;
    }
    if (hit && hit.grooveEl) {
      clearSplicerMagnetHighlight();
      hit.grooveEl.classList.add('magnet-active');
    } else if (hit && hit.machineId && hit.side) {
      setSplicerDropzoneHighlight(hit.machineId, hit.side);
    } else {
      clearSplicerMagnetHighlight();
    }
  }

  function clearSplicerMagnetHighlight() {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.clearSplicerMagnetHighlights === 'function') {
      FusionSplicerMachine.clearSplicerMagnetHighlights();
      return;
    }
    document.querySelectorAll('.clamp-base-groove.magnet-active').forEach(function (el) {
      el.classList.remove('magnet-active');
    });
  }

  /** Magnet glow only while dragging — rigid snap executes on pointerup drop. */
  function applySplicerMagnetDuringDrag(p, clientX, clientY, end, opts) {
    opts = opts || {};
    end = resolveCableEnd(p, end);
    p.activeCableEnd = end;
    var detached = end === 'start' ? p.startSplicerDragDetached : p.splicerDragDetached;
    if (detached) return;
    if (!splicerEligibleForSnap(p, end)) {
      if (end === 'start') p.startSplicerPreviewSlot = null;
      else p.splicerPreviewSlot = null;
      clearSplicerMagnetHighlight();
      return;
    }
    var probe = splicerDragProbeClientXY(p, end, clientX, clientY, !!opts.probeTip);
    var splicerHit = hitTestSplicerGroove(probe.x, probe.y);
    if (splicerHit && splicerHit.slot) {
      if (end === 'start') p.startSplicerPreviewSlot = splicerHit.slot;
      else p.splicerPreviewSlot = splicerHit.slot;
      highlightSplicerGrooveHit(splicerHit);
      return;
    }
    if (end === 'start') p.startSplicerPreviewSlot = null;
    else p.splicerPreviewSlot = null;
    clearSplicerMagnetHighlight();
  }

  /** Lock pigtail into groove on pointer release. */
  function finishSplicerMagnetOnDrop(p, clientX, clientY, end, opts) {
    opts = opts || {};
    end = resolveCableEnd(p, end);
    p.activeCableEnd = end;
    if (!splicerEligibleForSnap(p, end)) return false;
    var probe = splicerDragProbeClientXY(p, end, clientX, clientY, !!opts.probeTip);
    var dropHit = hitTestSplicerGroove(probe.x, probe.y);
    if (dropHit && dropHit.slot) {
      return finishSplicerDropSeat(p, dropHit, end);
    }
    return false;
  }

  function setSplicerDropzoneHighlight(machineId, side) {
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.setSplicerDropzoneActive === 'function') {
      FusionSplicerMachine.setSplicerDropzoneActive(machineId, side, true);
    }
  }

  function clearSplicerDropzoneHighlight() {
    clearSplicerMagnetHighlight();
    if (global.FusionSplicerMachine && typeof FusionSplicerMachine.clearSplicerDropzones === 'function') {
      FusionSplicerMachine.clearSplicerDropzones();
    }
  }

  /* ─── Fusion splicer heat-oven magnet (fused assembly only) ─── */

  function getFusedWeldWorld(machineId) {
    var asm = fusedAssemblies[machineId] || findFusionAssemblyByMachineId(machineId);
    if (asm && asm.meetX != null && asm.bridgeY != null) {
      return { x: asm.meetX, y: asm.bridgeY };
    }
    var pair = getFusedAssemblyPigtails(machineId);
    if (!pair.left) return null;
    var asmWeld = fusedAssemblies[machineId] || asm;
    var weldL = getFusedMemberWeldWorld(pair.left, asmWeld);
    var weldR = pair.right ? getFusedMemberWeldWorld(pair.right, asmWeld) : null;
    if (weldL && weldR) {
      return { x: (weldL.x + weldR.x) / 2, y: (weldL.y + weldR.y) / 2 };
    }
    return weldL || weldR;
  }

  function ovenEligibleForSnap(assemblyId, splicerMachineId) {
    if (!assemblyId || !isFusedAssembly(assemblyId)) return false;
    splicerMachineId = splicerMachineId || getSplicerMachineForAssembly(assemblyId);
    var asm = ensureFusedAssemblyOvenState(assemblyId);
    if (asm && (asm.isOvenDocked || asm.heatPhase === 'heating' || asm.sleeveShrunk)) return false;
    if (!fusedAssemblyHasShrinkSleeve(assemblyId)) return false;
    var pair = getFusedAssemblyPigtails(assemblyId);
    if (!pair.left || !pair.right) return false;
    if (pair.left.isSnappedToSplicer || pair.right.isSnappedToSplicer) return false;
    if (!global.FusionSplicerMachine || typeof FusionSplicerMachine.getOvenSlot !== 'function') {
      return false;
    }
    var slot = FusionSplicerMachine.getOvenSlot(splicerMachineId);
    return !!slot;
  }

  function clearOvenMagnetHighlight() {
    if (global.FusionSplicerMachine &&
        typeof FusionSplicerMachine.clearOvenMagnetHighlights === 'function') {
      FusionSplicerMachine.clearOvenMagnetHighlights();
    }
  }

  /**
   * Preview-only oven magnet while dragging a fused assembly.
   * Probes the weld joint (not the pointer) against the padded oven channel.
   */
  function applyOvenMagnetDuringFusedDrag(assemblyId, splicerMachineId) {
    if (!assemblyId) {
      clearOvenMagnetHighlight();
      return null;
    }
    splicerMachineId = splicerMachineId || getSplicerMachineForAssembly(assemblyId);
    if (!ovenEligibleForSnap(assemblyId, splicerMachineId)) {
      clearOvenMagnetHighlight();
      if (fusedAssemblies[assemblyId]) fusedAssemblies[assemblyId].ovenPreviewSlot = null;
      return null;
    }
    var weld = getFusedWeldWorld(assemblyId);
    if (!weld || !global.FusionSplicerMachine ||
        typeof FusionSplicerMachine.hitTestOvenSlotAtClient !== 'function' ||
        typeof FusionSplicerMachine.worldToClient !== 'function') {
      clearOvenMagnetHighlight();
      return null;
    }
    var client = FusionSplicerMachine.worldToClient(weld.x, weld.y);
    var hit = FusionSplicerMachine.hitTestOvenSlotAtClient(splicerMachineId, client.x, client.y);
    if (hit) {
      if (typeof FusionSplicerMachine.highlightOvenSlot === 'function') {
        FusionSplicerMachine.highlightOvenSlot(splicerMachineId);
      }
      if (fusedAssemblies[assemblyId]) fusedAssemblies[assemblyId].ovenPreviewSlot = hit;
      return hit;
    }
    clearOvenMagnetHighlight();
    if (fusedAssemblies[assemblyId]) fusedAssemblies[assemblyId].ovenPreviewSlot = null;
    return null;
  }

  function finishSplicerDropSeat(p, hit, end) {
    if (!hit || !hit.slot) return false;
    end = resolveCableEnd(p, end);
    var ok = seatFiberInSplicerGroove(p, hit.slot, { end: end });
    if (!ok) return false;
    refreshFusedChainMembersAfterRigidShift(p.id);
    renderSplicerFiberOverlays(hit.slot.machineId);
    return true;
  }

  function handoverPigtailToSplicerClamp(machineId, side, opts) {
    opts = opts || {};
    var slot = getSplicerGrooveSlot(machineId, side);
    if (!slot) return { ok: false, reason: 'no-slot' };
    if (!slot.open && !opts.forceOpen) return { ok: false, reason: 'clamp-closed' };

    var target = opts.pigtailId ? parseFiberTargetId(opts.pigtailId) : null;
    var pig = target ? target.p : (opts.pigtailId ? findPigtail(opts.pigtailId) : null);
    var cableEnd = target ? target.end : (opts.cableEnd || null);
    var i;
    if (!pig) {
      pig = findSnappedPigtailOnSide(machineId, side);
      if (pig && pig.cableEnd) cableEnd = pig.cableEnd;
    }
    if (!pig) {
      for (i = 0; i < pigtails.length; i++) {
        var cand = pigtails[i];
        if (isCable(cand)) {
          var ends = ['start', 'end'];
          var ei;
          for (ei = 0; ei < ends.length; ei++) {
            var endTry = ends[ei];
            if (!splicerEligibleForSnap(cand, endTry)) continue;
            if (cableEndIsSnappedToSplicer(cand, endTry) &&
                (endTry === 'start' ? cand.startSnappedSplicerId : cand.snappedSplicerId) === machineId) {
              continue;
            }
            pig = cand;
            cableEnd = endTry;
            break;
          }
          if (pig) break;
          continue;
        }
        if (!splicerEligibleForSnap(cand)) continue;
        if (cand.isSnappedToSplicer && cand.snappedSplicerId === machineId) continue;
        pig = cand;
        break;
      }
    }
    if (!pig) return { ok: false, reason: 'no-pigtail' };

    var ok = seatFiberInSplicerGroove(pig, slot, {
      force: !!opts.force,
      quiet: !!opts.quiet,
      end: cableEnd,
    });
    if (!ok) return { ok: false, reason: 'seat-failed' };

    updateFiberPath(pig);
    rebuildLayer();
    renderSplicerFiberOverlays(machineId);
    if (!opts.quiet) pushHistory();
    return { ok: true, pigtailId: pig.id, slot: slot };
  }

  /** Refresh docked pigtail geometry before motor-align distance math. */
  function prepareSplicerAlignmentTips(machineId) {
    if (!machineId) return false;
    try {
      var pair = getSplicerDockedPair(machineId);
      if (!pair.left || !pair.right) {
        console.warn('Alignment: cannot prepare tips — pigtails not docked');
        return false;
      }
      [pair.left, pair.right].forEach(function (p) {
        syncSnappedPigtailToLiveGroove(p);
        updateFiberPath(p);
      });
      renderSplicerFiberOverlays(machineId);
      return true;
    } catch (err) {
      console.error('Alignment Error:', err);
      return false;
    }
  }

  /** 60fps motor-align sync — force L/R docked pigtails to follow clamp CSS transform mid-transition. */
  function syncSplicerMotorAlignFrame(machineId) {
    if (!machineId) return false;
    var any = false;
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.isSnappedToSplicer || p.snappedSplicerId !== machineId) return;
      any = true;
      if (syncSnappedPigtailToLiveGroove(p)) changed = true;
      updateFiberPath(p);
    });
    if (any) renderSplicerFiberOverlays(machineId);
    return changed;
  }

  function refreshSplicerDocks(machineId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.isSnappedToSplicer) return;
      if (machineId && p.snappedSplicerId !== machineId) return;
      var slot = getSplicerGrooveSlot(p.snappedSplicerId, p.snappedSplicerSide, { forTracking: true });
      if (!slot) {
        clearSplicerSnap(p, { skipRebuild: true });
        changed = true;
        return;
      }
      if (syncSnappedPigtailToLiveGroove(p)) {
        updateFiberPath(p);
        changed = true;
      }
    });
    if (changed) {
      rebuildLayer();
      renderSplicerFiberOverlays(machineId);
    } else if (machineId) {
      renderSplicerFiberOverlays(machineId);
    } else {
      renderSplicerFiberOverlays();
    }
  }

  function renderSplicerFiberOverlays(machineId) {
    if (!global.FusionSplicerMachine || typeof FusionSplicerMachine.ensureFiberLayer !== 'function') {
      return;
    }
    var ids = {};
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var pg = pigtails[i];
      if (pg.isSnappedToSplicer && pg.snappedSplicerId) {
        ids[pg.snappedSplicerId] = true;
      }
      if (isCable(pg) && pg.startIsSnappedToSplicer && pg.startSnappedSplicerId) {
        ids[pg.startSnappedSplicerId] = true;
      }
    }
    if (machineId) ids[machineId] = true;

    Object.keys(ids).forEach(function (mid) {
      var host = FusionSplicerMachine.ensureFiberLayer(mid);
      if (!host) return;
      var svg = host.querySelector('.lab-pigtail-svg');
      if (!svg) return;
      var html = '';
      var dockedPair = getSplicerDockedPair(mid);
      var overlayAssemblyId = resolveFusionAssemblyIdForMachine(mid);
      var fused = overlayAssemblyId && isFusedAssembly(overlayAssemblyId);
      var overlayUnified = fused && !shouldRenderFusedBridgeInMainLayer(overlayAssemblyId);
      if (overlayUnified) {
        html += '<g class="lab-splicer-fused-assembly" data-fused-assembly="' + overlayAssemblyId + '">';
      }
      pigtails.forEach(function (p) {
        var onMachine = (p.isSnappedToSplicer && p.snappedSplicerId === mid) ||
          (isCable(p) && p.startIsSnappedToSplicer && p.startSnappedSplicerId === mid);
        if (!onMachine) return;
        html +=
          '<g data-pt-fiber-wrap="' + p.id + '">' +
          buildPigtailFiberSvg(p, { splicerPort: true }) +
          '</g>';
      });
      if (overlayUnified) {
        html += buildFusedAssemblyUnifiedSvg(overlayAssemblyId, { splicerPort: true, skipWrapper: true });
        html += '</g>';
      }
      svg.innerHTML = html;
      rebindDragGripsInRoot(svg);
      if (FusionSplicerMachine.syncLidOverlays) {
        FusionSplicerMachine.syncLidOverlays(mid);
      }
    });

    if (global.FusionSplicerMachine.list) {
      FusionSplicerMachine.list().forEach(function (m) {
        if (ids[m.id]) return;
        var stale = document.querySelector('[data-fusion-fiber-layer="' + m.id + '"]');
        if (stale) {
          var svg = stale.querySelector('.lab-pigtail-svg');
          if (svg) svg.innerHTML = '';
        }
        if (FusionSplicerMachine.syncLidOverlays) {
          FusionSplicerMachine.syncLidOverlays(m.id);
        }
      });
    }
    reapplyStoredVflGlow();
  }

  /**
   * u is clamped to each segment [0,1] so empty space past the tip never hits.
   */
  function projectOntoFiberStrict(pts, wx, wy) {
    if (!pts || pts.length < 2) {
      return { x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: Infinity, onSegment: false };
    }
    var total = polylineLength(pts);
    var best = null;
    var acc = 0;
    var i;
    for (i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x;
      var ay = pts[i - 1].y;
      var bx = pts[i].x;
      var by = pts[i].y;
      var segDx = bx - ax;
      var segDy = by - ay;
      var segLen = Math.sqrt(segDx * segDx + segDy * segDy);
      var segLen2 = segLen * segLen;
      var u = segLen2 > 0 ? ((wx - ax) * segDx + (wy - ay) * segDy) / segLen2 : 0;
      var uClamped = Math.max(0, Math.min(1, u));
      var px = ax + segDx * uClamped;
      var py = ay + segDy * uClamped;
      var perp = dist2(wx, wy, px, py);
      var along = acc + uClamped * segLen;
      var cand = {
        x: px,
        y: py,
        rot: fiberPathTangentRotDeg(segDx, segDy),
        dist: along,
        t: total > 0 ? along / total : 0,
        perpDist: perp,
        onSegment: u >= -0.001 && u <= 1.001,
      };
      if (!best || perp < best.perpDist) best = cand;
      acc += segLen;
    }
    return best || {
      x: wx, y: wy, rot: 0, dist: 0, t: 0, perpDist: Infinity, onSegment: false,
    };
  }

  function polylineAxisBounds(pts) {
    var minX = Infinity;
    var maxX = -Infinity;
    var minY = Infinity;
    var maxY = -Infinity;
    var i;
    for (i = 0; i < (pts || []).length; i++) {
      var p = pts[i];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
  }

  function peelDirsFromPath(pts) {
    var tip = pts[0];
    var inner = pts.length > 1 ? pts[1] : tip;
    var dx = tip.x - inner.x;
    var dy = tip.y - inner.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { peelUx: dx / len, peelUy: dy / len };
  }

  /**
   * Notch must sit on remaining unstripped material:
   * - Jacket: anywhere inland on the yellow jacket
   * - Buffer: on exposed coating between bareTo and jacketTo
   */
  function notchIntersectsUnstrippedFiber(p, wx, wy, thresholdPx, end) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : STRIP_NOTCH_HIT_PX;
    thr = Math.min(thr, STRIP_NOTCH_HIT_PX);
    end = end ? cableEndFromToken(end) : 'end';
    if (!p || isCableEndCleaved(p, end)) return null;
    if (isCable(p) && !cableEndOwnsToolPoint(p, end, wx, wy)) return null;
    if (getCableEndStripStage(p, end) >= 2 && end === 'end' && !isCable(p)) return null;
    var fs = ensureCableEndStrip(p, end);
    clampStripFrontiersToPath(p, end);

    var pts = cableStripPathPoints(p, end);
    if (!pts || pts.length < 2) return null;
    var total = polylineLength(pts);
    var jacketTo = fs.jacketTo || 0;
    var bareTo = fs.bareTo || 0;
    var maxStrip = total;
    var hasJacketRemain = jacketTo < maxStrip - STRIP_TIP_EPS;
    var hasBufferRemain = jacketTo > STRIP_TIP_EPS && bareTo < jacketTo - STRIP_BUFFER_COMPLETE_PX;
    if (!hasJacketRemain && !hasBufferRemain) return null;

    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj || !proj.onSegment) return null;
    if (proj.perpDist > thr) return null;
    if (proj.dist < -0.01) return null;

    if (hasJacketRemain && proj.dist >= jacketTo - STRIP_TIP_EPS && proj.dist <= maxStrip + STRIP_TIP_EPS) {
      return stripHitFromProj(p, pts, proj, 0, 'jacket', thr, end);
    }

    if (hasBufferRemain && proj.dist >= bareTo - STRIP_TIP_EPS && proj.dist < jacketTo - STRIP_BUFFER_COMPLETE_PX) {
      return stripHitFromProj(p, pts, proj, 1, 'buffer', thr, end);
    }

    return null;
  }

  function projectPigtailStripNotch(id, wx, wy) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p) return null;
    var pts = cableStripPathPoints(p, target.end || 'end');
    if (!pts || pts.length < 2) return null;
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj) return null;
    var dirs = peelDirsFromPath(pts);
    return {
      dist: proj.dist,
      x: proj.x,
      y: proj.y,
      rot: proj.rot,
      perpDist: proj.perpDist,
      onSegment: proj.onSegment,
      peelUx: dirs.peelUx,
      peelUy: dirs.peelUy,
    };
  }

  /**
   * Arc-length from tip for an active peel — clamps to tip (0) when dragged past the end.
   */
  function peelAlongDistForSession(pts, wx, wy, session) {
    if (!pts || !session) return 0;
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj) return 0;
    var along = Math.max(0, proj.dist);
    if (!isFinite(along)) along = 0;
    if (along <= STRIP_TIP_EPS) return 0;
    if (!proj.onSegment && along < (session.startAlong || 0) + 2) {
      return along;
    }
    if (along > session.startAlong + STRIP_TIP_EPS) {
      along = session.startAlong;
    }
    return along;
  }

  function peelAcceptsNotch(proj, session) {
    if (!proj || !session) return false;
    if (proj.perpDist <= STRIP_NOTCH_HIT_PX + 2) return true;
    if (proj.dist <= Math.max(3, (session.startAlong || 0) * 0.2)) return true;
    return false;
  }

  /**
   * Commit the full clamped segment when the peel session ends or the tool passes the tip.
   */
  function commitStripPeelSession(id, layerKind, session) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p || !session) return;
    var end = target.end || 'end';
    var fs = ensureCableEndStrip(p, end);
    if (end === 'start') {
      p.startIsCleaned = false;
      p.startIsStripped = true;
    } else {
      p.isCleaned = false;
      p.isStripped = true;
    }
    var maxLen = maxCableEndStripLenPx(p, end);
    var clampAlong = Math.min(maxLen, Math.max(0, session.startAlong || 0));
    if (layerKind === 'jacket') {
      fs.jacketTo = Math.min(maxLen, Math.max(fs.jacketTo || 0, clampAlong));
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
    } else if (layerKind === 'buffer') {
      var cap = Math.min(fs.jacketTo || 0, clampAlong);
      fs.bareTo = Math.min(fs.jacketTo || 0, Math.max(fs.bareTo || 0, cap));
      snapBareToJacket(fs);
    }
    fs.peel = 0;
    fs.peelLayer = null;
    var committedLen = layerKind === 'buffer'
      ? Math.max(fs.bareTo || 0, fs.jacketTo || 0)
      : Math.max(fs.jacketTo || 0, 0);
    applyStrippedLengthPx(p, end, committedLen, { layer: layerKind, bufferPeel: layerKind === 'buffer' });
    if (isCable(p)) syncCablePrepState(p);
    else syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /**
   * Apply a clamp-and-drag strip from the cutting-notch world position.
   * Frontier = session.startAlong − notchAlong (arc-length from tip); completes at clamp point.
   */
  function applyStripDragFromNotch(id, wx, wy, layerKind, session) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p || !session) return null;
    var end = target.end || 'end';
    var fs = ensureCableEndStrip(p, end);
    clampStripFrontiersToPath(p, end);
    if (layerKind === 'buffer' && (fs.jacketTo || 0) < STRIP_TIP_EPS) return null;

    var pts = cableStripPathPoints(p, end);
    if (!pts || pts.length < 2) return null;

    var along = peelAlongDistForSession(pts, wx, wy, session);
    var proj = projectOntoFiberStrict(pts, wx, wy);
    if (!proj || !peelAcceptsNotch(proj, session)) {
      if (along <= STRIP_TIP_EPS) {
        commitStripPeelSession(id, layerKind, session);
        proj = projectOntoFiberStrict(pts, pts[0].x, pts[0].y);
        return {
          ok: true,
          proj: proj,
          peeled: session.startAlong,
          jacketTo: fs.jacketTo,
          bareTo: fs.bareTo,
          peelUx: peelDirsFromPath(pts).peelUx,
          peelUy: peelDirsFromPath(pts).peelUy,
          completed: true,
        };
      }
      return null;
    }

    var maxLen = maxCableEndStripLenPx(p, end);
    var clampAlong = Math.min(maxLen, Math.max(0, session.startAlong || 0));
    var targetFrontier = Math.max(0, clampAlong - along);
    var peeled = clampAlong - targetFrontier;
    var animPx = layerKind === 'buffer' ? STRIP_PEEL_ANIM_PX * 0.85 : STRIP_PEEL_ANIM_PX;

    if (layerKind === 'jacket') {
      var newJacket = Math.min(maxLen, Math.max(fs.jacketTo || 0, targetFrontier));
      if (newJacket + STRIP_TIP_EPS < fs.jacketTo) return null;
      fs.jacketTo = newJacket;
      if (fs.bareTo > fs.jacketTo) fs.bareTo = fs.jacketTo;
      fs.peelLayer = 'jacket';
      fs.peel = Math.min(1, peeled / animPx);
    } else if (layerKind === 'buffer') {
      var newBare = Math.min(fs.jacketTo || 0, Math.max(fs.bareTo || 0, targetFrontier));
      if (newBare + STRIP_TIP_EPS < fs.bareTo) return null;
      fs.bareTo = newBare;
      if (along <= STRIP_TIP_EPS || isBareStripComplete(fs)) {
        snapBareToJacket(fs);
      }
      fs.peelLayer = 'buffer';
      fs.peel = Math.min(1, peeled / animPx);
    } else {
      return null;
    }

    var liveLen = layerKind === 'buffer'
      ? Math.max(fs.bareTo || 0, fs.jacketTo || 0)
      : Math.max(fs.jacketTo || 0, 0);
    applyStrippedLengthPx(p, end, liveLen, { layer: layerKind, bufferPeel: layerKind === 'buffer' });
    if (isCable(p)) {
      var stage = (fs.bareTo || 0) >= (fs.jacketTo || 0) - STRIP_TIP_EPS ? 2 :
        ((fs.jacketTo || 0) > STRIP_TIP_EPS ? 1 : 0);
      setCableEndStripStage(p, end, stage);
      syncCablePrepState(p);
    } else {
      syncStripStageFromFiberStrip(p);
    }
    updateStripVisuals(p);
    return {
      ok: true,
      proj: proj,
      peeled: peeled,
      jacketTo: fs.jacketTo,
      bareTo: fs.bareTo,
      peelUx: peelDirsFromPath(pts).peelUx,
      peelUy: peelDirsFromPath(pts).peelUy,
      completed: along <= STRIP_TIP_EPS,
    };
  }

  function findStripTarget(clientX, clientY, thresholdPx) {
    var world = clientToWorld(clientX, clientY);
    return findStripTargetAtWorld(world.x, world.y, thresholdPx);
  }

  /**
   * Precision probe: world cutting-notch must intersect unstripped jacket or buffer.
   */
  function findStripTargetAtWorld(wx, wy, thresholdPx) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : STRIP_NOTCH_HIT_PX;
    thr = Math.min(thr, STRIP_NOTCH_HIT_PX);
    var best = null;
    var bestScore = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      if (isCable(p)) {
        var nearEnd = nearestCableEndAtWorld(p, wx, wy);
        var hit = notchIntersectsUnstrippedFiber(p, wx, wy, thr, nearEnd);
        if (!hit) continue;
        var tipDist = cableEndTipDist(p, nearEnd, wx, wy);
        var score = hit.perpDist + tipDist * 0.02;
        if (score < bestScore) {
          bestScore = score;
          best = hit;
        }
        continue;
      }
      var hitP = notchIntersectsUnstrippedFiber(p, wx, wy, thr, 'end');
      if (!hitP) continue;
      if (hitP.perpDist < bestScore) {
        bestScore = hitP.perpDist;
        best = hitP;
      }
    }
    return best;
  }

  /**
   * Intersect a polyline with vertical line x = cutX; pick crossing nearest nearY.
   */
  function intersectPolylineWithVertical(pts, cutX, nearY) {
    if (!pts || pts.length < 2) return null;
    var best = null;
    var bestDy = Infinity;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var ax = pts[i].x;
      var ay = pts[i].y;
      var bx = pts[i + 1].x;
      var by = pts[i + 1].y;
      var minx = Math.min(ax, bx) - 0.5;
      var maxx = Math.max(ax, bx) + 0.5;
      if (cutX < minx || cutX > maxx) continue;
      var y;
      var t = 0;
      if (Math.abs(bx - ax) < 0.001) {
        if (Math.abs(ax - cutX) > 0.5) continue;
        y = ay;
      } else {
        t = (cutX - ax) / (bx - ax);
        if (t < -0.001 || t > 1.001) continue;
        y = ay + t * (by - ay);
      }
      var dy = Math.abs(y - nearY);
      if (dy < bestDy) {
        bestDy = dy;
        best = { x: cutX, y: y, segIndex: i, t: t };
      }
    }
    return best;
  }

  function trimOrthoPathAtCut(p, fullPts, cut) {
    if (!p || !fullPts || !cut) return;
    var newHist = [];
    var i;
    for (i = 1; i <= cut.segIndex; i++) {
      newHist.push({ x: fullPts[i].x, y: fullPts[i].y });
    }
    var cutPt = { x: cut.x, y: cut.y };
    if (!newHist.length) {
      p.pathHistory = [];
    } else {
      var last = newHist[newHist.length - 1];
      if (dist2(last.x, last.y, cutPt.x, cutPt.y) >= ORTHO_MIN_SEG) {
        newHist.push(cutPt);
      } else {
        newHist[newHist.length - 1] = cutPt;
      }
      p.pathHistory = newHist;
    }
    syncPathAlias(p);
    if (p.snake) {
      p.snake.axis = 'h';
      p.snake.ghost = null;
    }
  }

  /**
   * Truncate visible fiber at blade X — discard the tip-side (right) excess.
   */
  function truncateFiberAtBladeX(p, bladeX, bladeY) {
    if (!p) return null;
    var cutPt;
    if (usesOrthoRoute(p)) {
      var full = orthoPolyline(p);
      var cut = intersectPolylineWithVertical(full, bladeX, bladeY);
      if (cut) {
        cutPt = { x: cut.x, y: cut.y };
        trimOrthoPathAtCut(p, full, cut);
      } else {
        var sleevePts = fiberSleevePathPoints(p);
        var proj = projectOntoFiberStrict(sleevePts, bladeX, bladeY);
        cutPt = { x: bladeX, y: proj.y };
        trimOrthoPathAtCut(p, full, {
          x: cutPt.x,
          y: cutPt.y,
          segIndex: Math.max(0, full.length - 2),
          t: 1,
        });
      }
    } else {
      var pts = fiberSleevePathPoints(p);
      var proj2 = projectOntoFiberStrict(pts, bladeX, bladeY);
      cutPt = { x: bladeX, y: proj2.y };
    }
    p.bx = Math.round(cutPt.x);
    p.by = Math.round(cutPt.y);
    return cutPt;
  }

  /**
   * Point-to-line hit test: perpendicular distance from blade drop to pigtail polyline.
   * Requires fully stripped bare glass (stripStage === 2).
   */
  function findPigtailBladeHit(bladeX, bladeY, hitRadiusPx, cleaverId) {
    var thr = typeof hitRadiusPx === 'number' ? hitRadiusPx : BLADE_HIT_RADIUS_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var ends = isCable(p) ? cleaverCableEndsForProbe(p, cleaverId, bladeX, bladeY) : ['end'];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!p || isCableEndCleaved(p, end)) continue;
        if (getCableEndStripStage(p, end) !== 2) continue;
        if (!isCable(p) && p.tail && p.tail.attached) continue;
        var pts = cableStripPathPoints(p, end);
        if (!pts || pts.length < 2) continue;
        var proj = projectOntoFiberStrict(pts, bladeX, bladeY);
        if (!proj || proj.perpDist > thr) continue;
        var score = proj.perpDist + cableEndTipDist(p, end, bladeX, bladeY) * 0.02;
        if (score < bestD) {
          bestD = score;
          best = {
            id: fiberTargetId(p, end),
            end: end,
            x: proj.x,
            y: proj.y,
            rot: proj.rot,
            perpDist: proj.perpDist,
            along: proj.dist,
          };
        }
      }
    }
    return best;
  }

  /**
   * Distance-based cleave at blade drop — ignores magnetic snap / groove docking.
   */
  function commitCleaveAtBlade(bladeX, bladeY, opts) {
    opts = opts || {};
    var docked = findDockedCleaverCleaveTarget(opts.cleaverId);
    if (docked) {
      return commitCleave(docked.id, {
        cleaverId: opts.cleaverId,
        mountedEnd: docked.end,
        fromCleaverDock: true,
        cleaveAngle: opts.cleaveAngle,
        cleaveFaceRot: opts.cleaveFaceRot,
      });
    }
    var radius = typeof opts.hitRadius === 'number' ? opts.hitRadius : BLADE_HIT_RADIUS_PX;
    var hit = findPigtailBladeHit(bladeX, bladeY, radius, opts.cleaverId);
    if (!hit) return false;
    return commitCleave(hit.id, {
      cutX: bladeX,
      cutY: bladeY,
      cleaverId: opts.cleaverId,
      cleaveAngle: opts.cleaveAngle,
      cleaveFaceRot: opts.cleaveFaceRot,
    });
  }

  /**
   * Cleaver V-groove probe: bare stripped tip seated on groove under blade.
   */
  function findCleavTargetAtWorld(wx, wy, thresholdPx) {
    var thr = typeof thresholdPx === 'number' ? thresholdPx : CLEAVE_HIT_PX;
    thr = Math.min(thr, CLEAVE_HIT_PX);
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var ends = isCable(p) ? ['start', 'end'] : ['end'];
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!p || isCableEndCleaved(p, end)) continue;
        if (isCable(p) && !cableEndOwnsToolPoint(p, end, wx, wy)) continue;
        if (getCableEndStripStage(p, end) < 2) continue;
        if (!isCable(p) && p.tail && p.tail.attached) continue;
        var pts = cableStripPathPoints(p, end);
        if (!pts || pts.length < 2) continue;
        var proj = projectOntoFiberStrict(pts, wx, wy);
        if (!proj || !proj.onSegment) continue;
        if (proj.dist > CLEAVE_TIP_ZONE_PX) continue;
        if (proj.perpDist > thr) continue;
        var score = proj.perpDist + cableEndTipDist(p, end, wx, wy) * 0.02;
        if (score < bestD) {
          bestD = score;
          best = {
            id: fiberTargetId(p, end),
            end: end,
            x: proj.x,
            y: proj.y,
            rot: proj.rot,
            perpDist: proj.perpDist,
            along: proj.dist,
            wastePx: getBareGlassLengthAfterCutPx(),
          };
        }
      }
    }
    return best;
  }

  /**
   * Groove + blade alignment — fiber must lie on the horizontal channel under the blade.
   */
  function findCleavTargetInGroove(groove, blade, thresholdPx) {
    if (!groove || !blade) return null;
    var thr = typeof thresholdPx === 'number' ? thresholdPx : CLEAVE_HIT_PX;
    thr = Math.min(thr, CLEAVE_HIT_PX);
    var gx1 = Math.min(groove.x1, groove.x2);
    var gx2 = Math.max(groove.x1, groove.x2);
    var gy = (groove.y1 + groove.y2) * 0.5;
    if (Math.abs(blade.y - gy) > thr) return null;
    if (blade.x < gx1 - thr || blade.x > gx2 + thr) return null;
    var hit = findCleavTargetAtWorld(blade.x, blade.y, thr);
    if (!hit) return null;
    if (hit.x < gx1 - thr || hit.x > gx2 + thr) return null;
    if (Math.abs(hit.y - gy) > thr) return null;
    return hit;
  }

  /** Commit a precision cleave — slice at blade point, flat 90° end face. */
  function commitCleave(id, opts) {
    opts = opts || {};
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p) return false;
    var mountedEnd = opts.mountedEnd ||
      resolveCleaverMountedEnd(p, opts.cleaverId) ||
      target.end ||
      'end';
    var end = isCable(p) ? cableEndFromToken(mountedEnd) : 'end';
    var fromCleaverDock = !!opts.fromCleaverDock ||
      (!!opts.cleaverId && resolveCleaverMountedEnd(p, opts.cleaverId) === end);
    if (isCableEndCleaved(p, end)) return false;
    if (getCableEndStripStage(p, end) < 2) return false;
    var pts = cableStripPathPoints(p, end);
    if (!pts || pts.length < 2) return false;
    var total = polylineLength(pts);
    var cutDist;
    var bareLen = getBareGlassLengthAfterCutPx();
    if (fromCleaverDock) {
      cutDist = typeof opts.wastePx === 'number' ? opts.wastePx : bareLen;
    } else if (typeof opts.cutX === 'number' && typeof opts.cutY === 'number') {
      var proj = projectOntoFiberStrict(pts, opts.cutX, opts.cutY);
      if (!proj || !proj.onSegment) return false;
      if (proj.perpDist > CLEAVE_HIT_PX) return false;
      if (proj.dist > CLEAVE_TIP_ZONE_PX) return false;
      cutDist = proj.dist;
    } else {
      cutDist = typeof opts.wastePx === 'number' ? opts.wastePx : bareLen;
    }
    if (cutDist < CLEAVE_MIN_CUT_PX) cutDist = CLEAVE_MIN_CUT_PX;
    if (total < cutDist + 6) cutDist = Math.max(CLEAVE_MIN_CUT_PX, total - 6);

    var anchor = captureCleaveStripAnchor(p, opts.cleaverId, end);
    var newTip = pointAtPathDistance(pts, cutDist);
    if (end === 'start') {
      p.ax = newTip.x;
      p.ay = newTip.y;
      p.startIsCleaved = true;
      p.startCleaved = true;
      syncCablePrepState(p);
      if (p.startPrepState) p.startPrepState.cleaved = true;
    } else {
      p.bx = newTip.x;
      p.by = newTip.y;
      p.isCleaved = true;
      p.cleaved = true;
      syncCablePrepState(p);
      if (isCable(p) && p.endPrepState) p.endPrepState.cleaved = true;
    }
    if (isCable(p)) {
      p.activeCableEnd = end;
      p.mountedCleaverEnd = end;
    }
    syncCablePrepState(p);
    clearCleaverSnap(p, { skipGuide: true, end: end });
    lockCleavedStripGeometry(p, bareLen, {
      end: end,
      preJacketTo: anchor.preJacketTo,
      removedFromTip: cutDist,
      jacketBoundaryX: anchor.jacketBoundaryX,
      rulerStopX: anchor.rulerStopX,
    });
    restoreCableEndCleavedStripLock(p, end);
    p.cleaveAngle = typeof opts.cleaveAngle === 'number' ? opts.cleaveAngle : 90;
    p.cleaveFaceRot = typeof opts.cleaveFaceRot === 'number' ? opts.cleaveFaceRot : p.cleaveAngle;
    updateFiberPath(p);
    rebuildLayer();
    pushHistory();
    updateInspector();
    refreshBudget();
    if (isCable(p)) selectCable(p.id);
    else selectPigtail(p.id);
    setStatus((isCable(p) ? 'Cable · ' + end + ' end' : 'SC Pigtail') +
      ' · fiber cleaved · perpendicular end face');
    if (global.FtthLab && typeof FtthLab.showToast === 'function') {
      FtthLab.showToast('تم القص 90°');
    }
    return true;
  }

  function setStripPeel(id, peel) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = target.end || 'end';
    if (!p || isCableEndCleaved(p, end)) return;
    var fs = ensureCableEndStrip(p, end);
    if (getCableEndStripStage(p, end) >= 2 && (fs.peelLayer || '') !== 'jacket') return;
    var n = Number(peel);
    if (!isFinite(n)) n = 0;
    fs.peel = Math.max(0, Math.min(1, n));
    if (isCable(p)) syncCablePrepState(p);
    else syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /** Legacy hook — sets jacket frontier length from tip. */
  function setStripLengthPx(id, px) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = target.end || 'end';
    if (!p || isCableEndCleaved(p, end)) return;
    clampStripFrontiersToPath(p, end);
    applyStrippedLengthPx(p, end, px);
    if (isCable(p)) syncCablePrepState(p);
    else syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  function clearStripPeel(id) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    if (!p) return;
    var fs = ensureCableEndStrip(p, target.end || 'end');
    fs.peel = 0;
    fs.peelLayer = null;
    if (isCable(p)) syncCablePrepState(p);
    else syncStripStageFromFiberStrip(p);
    updateStripVisuals(p);
  }

  /** Stage is derived from fiberStrip frontiers — no fixed-length snap. */
  function commitStripStage(id) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = target.end || 'end';
    if (!p || isCableEndCleaved(p, end)) return false;
    var fs = ensureCableEndStrip(p, end);
    if (end === 'start') p.startIsCleaned = false;
    else p.isCleaned = false;
    if (isCable(p)) {
      var stageVal = (fs.bareTo || 0) >= (fs.jacketTo || 0) - STRIP_TIP_EPS ? 2 :
        ((fs.jacketTo || 0) > STRIP_TIP_EPS ? 1 : 0);
      setCableEndStripStage(p, end, stageVal);
      applyStrippedLengthPx(p, end, Math.max(fs.jacketTo || 0, fs.bareTo || 0));
      syncCablePrepState(p);
    } else {
      syncStripStageFromFiberStrip(p);
    }
    fs.peel = 0;
    fs.peelLayer = null;
    rebuildLayer();
    pushHistory();
    updateInspector();
    var stage = getCableEndStripStage(p, end);
    var label = isCable(p) ? 'Cable' : 'SC Pigtail';
    setStatus(
      stage >= 2
        ? label + ' · buffer stripped · bare glass exposed'
        : stage >= 1
          ? label + ' · jacket stripped · clamp buffer to peel coating'
          : label + ' · jacket peel in progress'
    );
    return true;
  }

  function syncTailStripDom(p, tail, end) {
    if (!p || !tail) return;
    end = end ? cableEndFromToken(end) : 'end';
    var fs = ensureCableEndStrip(p, end);
    if (!isCable(p)) enforceFullStripBareFrontier(p);
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var j = fs.jacketTo || 0;
    var fullyStripped = isCable(p)
      ? isCableEndFullyStripped(p, end)
      : isFullyStrippedPigtail(p);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    var jacketStripped = j > STRIP_TIP_EPS;
    var cleaved = isCableEndCleaved(p, end);

    tail.classList.toggle('is-strip-peeling', peel > 0.02);
    tail.style.setProperty('--strip-peel', peel.toFixed(3));
    tail.classList.toggle('is-strip-stage1', jacketStripped);
    tail.classList.toggle('is-strip-stage2', bareComplete);
    tail.classList.toggle('is-cleaved', cleaved);

    var jacketEl = tail.querySelector('.lab-pigtail__jacket');
    var bufferEl = tail.querySelector('.lab-pigtail__buffer');
    var cleaveEl = tail.querySelector('.lab-pigtail__cleave');
    if (jacketEl) {
      jacketEl.classList.toggle('is-strip-removed', jacketStripped);
      jacketEl.classList.toggle('is-strip-peeling', peel > 0.02 && peelLayer === 'jacket');
    }
    if (bufferEl) {
      bufferEl.classList.toggle('is-strip-exposed', !fullyStripped && jacketStripped && !bareComplete);
      bufferEl.classList.toggle('is-strip-jacketed', !jacketStripped);
      bufferEl.classList.toggle('is-strip-removed', bareComplete);
      bufferEl.classList.toggle('is-strip-peeling', peel > 0.02 && peelLayer === 'buffer');
    }
    if (cleaveEl) {
      cleaveEl.classList.toggle('is-strip-bare', bareComplete);
      cleaveEl.classList.toggle('is-strip-buffered', !fullyStripped && jacketStripped && !bareComplete);
      cleaveEl.classList.toggle('is-cleaved', cleaved);
    }
  }

  function updateStripVisuals(p) {
    if (!layer || !p) return;
    if (isCable(p)) syncCablePrepState(p);
    else ensureFiberStrip(p);
    replacePigtailFiberSvg(p);
    if (isCable(p)) {
      var aBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="A"]');
      var bBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
      syncTailStripDom(p, aBtn, 'start');
      syncTailStripDom(p, bBtn, 'end');
      return;
    }
    var tail = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    syncTailStripDom(p, tail, 'end');
  }

  function replacePigtailFiberSvg(p, opts) {
    opts = opts || {};
    if (!layer || !p) return;
    var svg = layer.querySelector('.lab-pigtail-svg');
    if (!svg) return;
    function fiberAttrMatches(attrVal) {
      if (!attrVal) return false;
      if (attrVal === p.id) return true;
      return isCable(p) && attrVal.indexOf(p.id + ':') === 0;
    }
    function isFiberNode(n) {
      if (!n || n.nodeType !== 1) return false;
      return (
        n.getAttribute('data-pt-drag') === p.id ||
        fiberAttrMatches(n.getAttribute('data-pt-fiber')) ||
        fiberAttrMatches(n.getAttribute('data-pt-fiber-stripped')) ||
        fiberAttrMatches(n.getAttribute('data-pt-residue')) ||
        n.getAttribute('data-pt-ghost') === p.id ||
        fiberAttrMatches(n.getAttribute('data-pt-laser'))
      );
    }
    var child = svg.firstChild;
    var first = null;
    while (child) {
      if (isFiberNode(child)) {
        first = child;
        break;
      }
      child = child.nextSibling;
    }
    var insertBefore = null;
    if (first) {
      var cur = first;
      while (cur && isFiberNode(cur)) {
        var next = cur.nextSibling;
        svg.removeChild(cur);
        cur = next;
      }
      insertBefore = cur;
    }
    var temp = document.createElement('div');
    temp.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + buildPigtailFiberSvg(p) + '</svg>';
    var wrap = temp.firstChild;
    if (!wrap) return;
    while (wrap.firstChild) {
      var node = wrap.firstChild;
      wrap.removeChild(node);
      if (insertBefore) svg.insertBefore(node, insertBefore);
      else svg.appendChild(node);
    }
    if (isPigtailFused(p) && !opts.skipFusedAssemblyRefresh) {
      var asmSeen = {};
      var refreshEnds = isCable(p) ? ['start', 'end'] : ['end'];
      refreshEnds.forEach(function (end) {
        var asmId = getMemberEndFusionAssemblyId(p, end);
        if (!asmId || asmSeen[asmId]) return;
        asmSeen[asmId] = true;
        if (document.body.classList.contains('lab-pigtail-dragging')) {
          refreshFusedAssemblyInMainLayer(asmId);
        } else {
          syncFusedAssemblyVisuals(asmId);
        }
      });
      rebindDragGripsInRoot(svg);
    } else if (p.isSnappedToSplicer) {
      renderSplicerFiberOverlays(p.snappedSplicerId);
    }
  }

  function findCleanableStrippedFiberAtClient(clientX, clientY) {
    var id = hitTestPigtailBareEnd(clientX, clientY);
    if (!id) {
      var world = clientToWorld(clientX, clientY);
      var near = findBareTipNearWorld(world.x, world.y, 30);
      id = near ? near.id : null;
    }
    if (!id) return null;
    var target = parseFiberTargetId(id);
    var p = target ? target.p : findPigtail(id);
    var end = target ? target.end : 'end';
    if (!p || !isCableEndFullyStripped(p, end)) return null;
    if (isCableEndCleaned(p, end)) return null;
    return {
      id: fiberTargetId(p, end),
      end: end,
      isCleaned: false,
      isCleaved: isCableEndCleaved(p, end),
      type: isCable(p) ? 'cable' : 'pigtail',
    };
  }

  /** Late wipe on a cleaved end ruins the precision cut — forces re-cleave (1→2→3 order). */
  function invalidateCableEndCleave(p, end) {
    if (!p || !isCableEndCleaved(p, end)) return false;
    end = resolveCableEnd(p, end);
    if (isCable(p)) {
      if (end === 'start') {
        p.startIsCleaved = false;
        p.startCleaved = false;
        p.startCleavedStripLock = null;
        if (p.startPrepState) p.startPrepState.cleaved = false;
      } else {
        p.isCleaved = false;
        p.cleaved = false;
        p.cleavedStripLock = null;
        if (p.endPrepState) p.endPrepState.cleaved = false;
      }
    } else {
      p.isCleaved = false;
      p.cleaved = false;
      p.cleavedStripLock = null;
      if (p.prepState) p.prepState.cleaved = false;
    }
    syncCablePrepState(p);
    return true;
  }

  /** Mark a fully stripped pigtail bare fiber as cleaned. */
  function markPigtailCleaned(id) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = target.end || 'end';
    if (!p || !isCableEndFullyStripped(p, end)) return false;
    if (isCableEndCleaned(p, end)) return false;
    var ruinedCleave = isCableEndCleaved(p, end);
    if (ruinedCleave) invalidateCableEndCleave(p, end);
    if (end === 'start') p.startIsCleaned = true;
    else p.isCleaned = true;
    syncCablePrepState(p);
    updateStripVisuals(p);
    rebuildLayer();
    pushHistory();
    updateInspector();
    if (isCable(p)) selectCable(p.id);
    else selectPigtail(p.id);
    if (ruinedCleave) {
      setStatus('Fiber cleaned · cleave ruined — re-cleave before splice');
    }
    return true;
  }

  function findBareTipProximity(clientX, clientY, thresholdPx) {
    var world = clientToWorld(clientX, clientY);
    var thr = typeof thresholdPx === 'number' ? thresholdPx : SLEEVE_MOUNT_PROX_PX;
    var best = null;
    var bestD = thr + 1;
    var i;
    for (i = 0; i < pigtails.length; i++) {
      var p = pigtails[i];
      var ends = sleeveMountableEnds(p);
      var ei;
      for (ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!p) continue;
        if (!canMountSleeveOnEnd(p, end)) continue;
        if (pigtailEndHasSleeve(p, end)) continue;
        var d = isCable(p)
          ? sleeveMountProximityForEnd(p, end, world.x, world.y, thr)
          : dist2(world.x, world.y, cableEndTipWorld(p, end).x, cableEndTipWorld(p, end).y);
        if (d <= thr && d < bestD) {
          bestD = d;
          best = { p: p, end: end };
        }
      }
    }
    return best ? { id: fiberTargetId(best.p, best.end), dist: bestD } : null;
  }

  /** Slide a 60mm protection sleeve onto a pigtail bare tip. Returns true if applied. */
  function mountSleeve(id, opts) {
    opts = opts || {};
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = opts.end ? cableEndFromToken(opts.end) : (target.end || 'end');
    if (!p) return false;
    if (!canMountSleeveOnEnd(p, end)) {
      setStatus('Sleeve slides on from the bare fiber tip only');
      selectPigtail(p.id);
      return false;
    }
    if (pigtailEndHasSleeve(p, end) && !opts.force) {
      setStatus(isCable(p) ? 'Sleeve already on this cable end' : 'Sleeve already on this pigtail');
      if (isCable(p)) selectCable(p.id);
      else selectPigtail(p.id);
      return false;
    }
    var pts = sleeveSlidePathPoints(p, end);
    var total = polylineLength(pts);
    var size = getSleeveSizePx();
    var along = typeof opts.sleeveAlong === 'number'
      ? Math.max(0, Math.min(1, opts.sleeveAlong))
      : defaultSleeveAlong(total, size.w);
    if (isCable(p)) {
      setCableEndSleeveState(p, end, true, along);
      syncCablePrepState(p);
    } else {
      p.hasSleeve = true;
      p.sleeveAlong = along;
      ensurePigtailPrepState(p);
      p.prepState.hasSleeve = true;
      p.prepState.sleeveAlong = along;
    }
    if (opts.consumeFreeSleeveId && global.FtthLab &&
        typeof FtthLab.consumeFreeSleeve === 'function') {
      FtthLab.consumeFreeSleeve(opts.consumeFreeSleeveId);
    }
    if (isCable(p)) selectCable(p.id);
    else selectPigtail(p.id);
    rebuildLayer();
    if (opts.slideIn !== false) triggerSleeveSlideIn(fiberTargetId(p, end));
    pushHistory();
    updateInspector();
    setStatus('Sleeve 60mm · slid onto bare fiber');
    return true;
  }

  function applySleeve(id, opts) {
    return mountSleeve(id, opts);
  }

  function ejectSleeve(id, wx, wy) {
    var target = parseFiberTargetId(id) || { p: findPigtail(id), end: 'end' };
    var p = target.p;
    var end = target.end || 'end';
    if (!p || !pigtailEndHasSleeve(p, end)) return null;
    if (isMemberEndSleeveShrunk(p, end)) return null;
    var g = sleeveGeometry(p, end);
    var spawnX = typeof wx === 'number' ? wx : g.x;
    var spawnY = typeof wy === 'number' ? wy : g.y;
    if (isCable(p)) {
      setCableEndSleeveState(p, end, false, null);
      syncCablePrepState(p);
    } else {
      p.hasSleeve = false;
      p.sleeveAlong = null;
      if (p.prepState) {
        p.prepState.hasSleeve = false;
        p.prepState.sleeveAlong = null;
      }
    }
    rebuildLayer();
    pushHistory();
    if (global.FtthLab && typeof FtthLab.placeFreeSleeve === 'function') {
      FtthLab.placeFreeSleeve(spawnX, spawnY, { fromEject: true });
    }
    setStatus('Sleeve ejected · free to move');
    return { x: spawnX, y: spawnY };
  }

  function hitTestPigtailBareEnd(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-id][data-pt-end], .lab-pigtail__tail, .lab-cable__end');
      if (!node) continue;
      var id = node.getAttribute('data-pt-id');
      var cableEnd = node.getAttribute('data-cable-end');
      if (id && findPigtail(id)) {
        return cableEnd ? fiberTargetId(findPigtail(id), cableEnd) : id;
      }
    }
    /* Near-tip tolerance: also accept fiber hit near bare end */
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-fiber], [data-pt-drag]');
      if (!node) continue;
      var fid =
        node.getAttribute('data-pt-fiber') ||
        node.getAttribute('data-pt-drag');
      var p = fid && findPigtail(fid);
      if (!p) continue;
      var world = clientToWorld(clientX, clientY);
      if (isCable(p)) {
        if (dist2(world.x, world.y, p.ax, p.ay) <= 36) return fiberTargetId(p, 'start');
        if (dist2(world.x, world.y, p.bx, p.by) <= 36) return fiberTargetId(p, 'end');
      } else if (dist2(world.x, world.y, p.bx, p.by) <= 36) {
        return fid;
      }
    }
    return null;
  }

  function hitTestPigtailAtClient(clientX, clientY) {
    var bare = hitTestPigtailBareEnd(clientX, clientY);
    if (bare) return bare;
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      if (!el || !el.closest) continue;
      node = el.closest('[data-pt-fiber], [data-pt-drag], [data-pt-id], [data-pt-node], [data-pt-sleeve]');
      if (!node) continue;
      var id =
        node.getAttribute('data-pt-fiber') ||
        node.getAttribute('data-pt-drag') ||
        node.getAttribute('data-pt-id') ||
        node.getAttribute('data-pt-node') ||
        node.getAttribute('data-pt-sleeve');
      if (id && findPigtail(id)) return id;
    }
    return null;
  }

  function pushHistory() {
    if (historyLocked) return;
    history = history.slice(0, historyIndex + 1);
    history.push(captureSnapshot());
    if (history.length > HISTORY_MAX) history.shift();
    historyIndex = history.length - 1;
    if (historyIndex > 0 && global.FtthLab && typeof FtthLab.recordHistory === 'function') {
      FtthLab.recordHistory('sc-pigtail');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · SC pigtail');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · SC pigtail');
    return true;
  }

  function defaultPos() {
    var w = getWorldSize();
    return {
      x: Math.round(w / 2 + 80 + pigtails.length * 28),
      y: Math.round(w / 2 + 240 + (pigtails.length % 3) * 40),
    };
  }

  function placePigtail(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    /* Pure horizontal spawn: SC on the left, bare tip straight right. */
    var tipX = pos.x + SPAWN_LEN_PX;
    var tipY = pos.y;
    var horizRot = endRotationDeg(pos.x, pos.y, tipX, tipY);
    var item = {
      id: 'pt-' + seq,
      jacketColor: 'Yellow',
      ax: pos.x,
      ay: pos.y,
      bx: tipX,
      by: tipY,
      polish: 'PC',
      connector: {
        attached: null,
        mismatch: false,
        lockedRot: null,
        liveRot: horizRot,
      },
      tail: { attached: null },
      route: [],
      pathHistory: [],
      routeMode: 'snake',
      lengthMeters: null,
      lengthUnit: 'm',
      fixedLength: SPAWN_LEN_PX,
      hasSleeve: false,
      isStripped: false,
      isCleaned: false,
      isCleaved: false,
      stripStage: 0,
      stripPeel: 0,
      stripLengthPx: 0,
      prepState: {
        stripped: false, cleaned: false, cleaved: false, coatingRemoved: false, strippedLengthPx: 0,
      },
      fiberStrip: { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null },
      drawLockRot: horizRot,
      isSnappedToCleaver: false,
      snappedCleaverId: null,
      cleaverSlotAnchorX: null,
      isSnappedToSplicer: false,
      snappedSplicerId: null,
      snappedSplicerSide: null,
      splicerGrooveY: null,
      splicerTipX: null,
      splicerPreviewSlot: null,
      splicerDragDetached: false,
      splicerGrooveAnchor: null,
      splicerBareGlassPx: null,
      splicerInnerEdgeX: null,
      splicerDockSnapshot: null,
      splicerWeldMachineId: null,
      fusionAssemblyId: null,
      fusedPartnerId: null,
      fusionPermanent: false,
      splicerFusedSide: null,
      fusedJacketEndDist: null,
      cleavedStripLock: null,
      stripFrontierLock: null,
    };
    pigtails.push(item);
    selectPigtail(item.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail placed · horizontal · drag connector or bare tip to route');
    return item;
  }

  function placeCable(x, y) {
    seq += 1;
    var pos = (typeof x === 'number' && typeof y === 'number')
      ? { x: x, y: y }
      : defaultPos();
    var tipX = pos.x + SPAWN_LEN_PX;
    var tipY = pos.y;
    var horizRot = endRotationDeg(pos.x, pos.y, tipX, tipY);
    var item = {
      id: 'cb-' + seq,
      type: 'cable',
      jacketColor: 'Yellow',
      ax: pos.x,
      ay: pos.y,
      bx: tipX,
      by: tipY,
      startPrepState: {
        stripped: false, cleaned: false, cleaved: false, coatingRemoved: false, strippedLengthPx: 0,
        hasSleeve: false, sleeveAlong: null,
      },
      endPrepState: {
        stripped: false, cleaned: false, cleaved: false, coatingRemoved: false, strippedLengthPx: 0,
        hasSleeve: false, sleeveAlong: null,
      },
      connector: { attached: null, mismatch: false, lockedRot: null, liveRot: horizRot },
      tail: { attached: null },
      route: [],
      pathHistory: [],
      routeMode: 'snake',
      lengthMeters: null,
      lengthUnit: 'm',
      fixedLength: SPAWN_LEN_PX,
      hasSleeve: false,
      sleeveAlong: null,
      startHasSleeve: false,
      startSleeveAlong: null,
      isStripped: false,
      startIsStripped: false,
      isCleaned: false,
      startIsCleaned: false,
      isCleaved: false,
      startIsCleaved: false,
      cleaved: false,
      startCleaved: false,
      stripStage: 0,
      startStripStage: 0,
      stripPeel: 0,
      startStripPeel: 0,
      stripLengthPx: 0,
      startStripLengthPx: 0,
      fiberStrip: { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null },
      startFiberStrip: { jacketTo: 0, bareTo: 0, peel: 0, peelLayer: null },
      drawLockRot: horizRot,
      isSnappedToCleaver: false,
      startIsSnappedToCleaver: false,
      snappedCleaverId: null,
      startSnappedCleaverId: null,
      cleaverSlotAnchorX: null,
      startCleaverSlotAnchorX: null,
      isSnappedToSplicer: false,
      startIsSnappedToSplicer: false,
      snappedSplicerId: null,
      startSnappedSplicerId: null,
      snappedSplicerSide: null,
      startSnappedSplicerSide: null,
      splicerGrooveY: null,
      startSplicerGrooveY: null,
      splicerTipX: null,
      startSplicerTipX: null,
      splicerPreviewSlot: null,
      startSplicerPreviewSlot: null,
      splicerDragDetached: false,
      startSplicerDragDetached: false,
      splicerGrooveAnchor: null,
      startSplicerGrooveAnchor: null,
      splicerBareGlassPx: null,
      startSplicerBareGlassPx: null,
      splicerInnerEdgeX: null,
      startSplicerInnerEdgeX: null,
      splicerDockSnapshot: null,
      startSplicerDockSnapshot: null,
      splicerWeldMachineId: null,
      startSplicerWeldMachineId: null,
      fusionAssemblyId: null,
      startFusionAssemblyId: null,
      fusedPartnerId: null,
      startFusedPartnerId: null,
      fusionPermanent: false,
      startFusionPermanent: false,
      isSleeveShrunk: false,
      startIsSleeveShrunk: false,
      splicerFusedSide: null,
      startSplicerFusedSide: null,
      fusedJacketEndDist: null,
      startFusedJacketEndDist: null,
      cleavedStripLock: null,
      startCleavedStripLock: null,
      stripFrontierLock: null,
      startStripFrontierLock: null,
      activeCableEnd: 'end',
    };
    syncCablePrepState(item);
    pigtails.push(item);
    selectCable(item.id);
    rebuildLayer();
    pushHistory();
    refreshBudget();
    setStatus('Cable placed · bare fiber both ends · drag either tip to route');
    return item;
  }

  function selectCable(id, opts) {
    selection = { kind: 'cable', id: id };
    claimSelection();
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function removePigtail(id) {
    var p = findPigtail(id);
    if (p && isPigtailFused(p)) {
      var asmIds = {};
      var ends = isCable(p) ? ['start', 'end'] : ['end'];
      ends.forEach(function (end) {
        var aid = getMemberEndFusionAssemblyId(p, end);
        if (aid) asmIds[aid] = true;
      });
      var ids = {};
      ids[id] = true;
      Object.keys(asmIds).forEach(function (asmId) {
        var pair = getFusedAssemblyPigtails(asmId);
        if (pair.left) ids[pair.left.id] = true;
        if (pair.right) ids[pair.right.id] = true;
        if (asmId && !isFusionAssemblyPermanent(fusedAssemblies[asmId])) {
          clearFusedAssembly(asmId);
        } else if (asmId) {
          delete fusedAssemblies[asmId];
        }
      });
      pigtails = pigtails.filter(function (pg) { return !ids[pg.id]; });
      syncGlobalFiberFusedFlag();
      syncGlobalSleeveShrunkFlag();
      if (selection.id && ids[selection.id]) selection = { kind: 'none', id: null };
      rebuildLayer();
      updateInspector();
      pushHistory();
      refreshBudget();
      setStatus('Fused splice assembly removed');
      return;
    }
    pigtails = pigtails.filter(function (pg) { return pg.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail removed');
  }

  function selectPigtail(id, opts) {
    selection = { kind: 'pigtail', id: id };
    claimSelection();
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function setConnectorPolish(id, polish) {
    var p = findPigtail(id);
    if (!p) return;
    p.polish = normalizePolish(polish);
    if (p.connector.attached) {
      var universal = isUniversalPortAttach(p.connector.attached);
      p.connector.mismatch = universal
        ? false
        : !polishMatch(p.polish, p.connector.attached.polish);
      p.connector.attached.mismatch = p.connector.mismatch;
      if (p.connector.mismatch) showWarning(MISMATCH_MSG);
    }
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    setStatus('SC Pigtail → ' + displayPolish(p.polish));
  }

  function getConnRot(p) {
    if (typeof p.drawLockRot === 'number') return p.drawLockRot;
    if (p.connector.attached) {
      if (typeof p.connector.lockedRot === 'number') return p.connector.lockedRot;
      if (p.connector.attached && typeof p.connector.attached.lockedRot === 'number') {
        p.connector.lockedRot = p.connector.attached.lockedRot;
        return p.connector.lockedRot;
      }
    }
    if (typeof p.connector.liveRot === 'number') return p.connector.liveRot;
    /* Boot aims toward bare tip — ferrule opposite (same as patch End A → B) */
    return endRotationDeg(p.ax, p.ay, p.bx, p.by);
  }

  function updateLiveHeading(p, dx, dy) {
    if (p.connector.attached) return;
    if (dist2(0, 0, dx, dy) < HEADING_MIN_PX) return;
    var target = headingRotFromMotion(dx, dy);
    if (typeof p.connector.liveRot === 'number') {
      p.connector.liveRot = lerpAngleDeg(p.connector.liveRot, target, HEADING_SMOOTH);
    } else {
      p.connector.liveRot = target;
    }
  }

  /** Seat ferrule on port face; boot exits along locked axis (patch-cord seatEndAtPort). */
  function seatConnectorAtPort(p, portX, portY) {
    var rot = getConnRot(p);
    if (p.connector.attached && typeof p.connector.lockedRot !== 'number') {
      p.connector.lockedRot = rot;
      p.connector.attached.lockedRot = rot;
    }
    rot = getConnRot(p);
    var t = bootOutDir(rot);
    p.ax = portX + t.x * BOOT_EXIT_OFFSET;
    p.ay = portY + t.y * BOOT_EXIT_OFFSET;
  }

  /** Exact rear tip of the ribbed boot — fiber path must start here. */
  function bootAnchor(p) {
    if (isCable(p)) return { x: p.ax, y: p.ay };
    return localToWorld(p.ax, p.ay, 0, BOOT_EXIT_OFFSET, getConnRot(p));
  }

  function unitVec(x, y) {
    var len = Math.sqrt(x * x + y * y) || 1;
    return { x: x / len, y: y / len };
  }

  /* ─── Hit tests ─── */

  function hitTestPort(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;

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
        var pw = null;
        if (global.FtthLab && typeof FtthLab.getCouplerPortWorld === 'function') {
          pw = FtthLab.getCouplerPortWorld(cid, cport);
        }
        var wx;
        var wy;
        if (pw) {
          wx = pw.x;
          wy = pw.y;
        } else {
          var r3 = node.getBoundingClientRect();
          var c3 = clientToWorld(r3.left + r3.width / 2, r3.top + r3.height / 2);
          wx = c3.x;
          wy = c3.y;
        }
        return {
          owner: 'coupler',
          couplerId: cid,
          port: cport,
          polish: cPolish,
          label: 'SC Coupler ' + cport + ' · ' + (cPolish === 'APC' ? 'SC/APC' : 'SC/PC'),
          wx: wx,
          wy: wy,
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
            FtthLab.showAlert('OLP-38 accepts SC connectors only (SC Pigtail / Patch Cord).', 'warn');
          }
          return null;
        }
        var knurl = node.querySelector('.viavi__adapter-knurl, .lab-opm__adapter-knurl') || node;
        var rO = knurl.getBoundingClientRect();
        var cO = clientToWorld(rO.left + rO.width / 2, rO.top + rO.height * 0.35);
        var otdrOpm = otdrPortMetaFromNode(node);
        var universal = isUniversalPortEl(node);
        return {
          owner: 'opm',
          opmId: oid,
          polish: otdrOpm ? otdrOpm.polish : 'UPC',
          universal: universal,
          connectorType: 'SC',
          label: otdrOpm ? otdrOpm.label : 'Viavi OLP-38 · SC adapter',
          wx: cO.x,
          wy: cO.y,
          el: node,
          otdr: isOtdrPortEl(node),
        };
      }

      node = el.closest && el.closest('.lab-ols-port[data-ols-port]');
      if (node) {
        var olsId = node.getAttribute('data-ols-port');
        var olsConn = (node.getAttribute('data-ols-connector') || 'SC').toUpperCase();
        if (olsConn !== 'SC') {
          if (global.FtthLab && FtthLab.showAlert) {
            FtthLab.showAlert('OLS-35 accepts SC connectors only (SC Pigtail / Patch Cord).', 'warn');
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
          otdr: isOtdrPortEl(node),
        };
      }
    }
    return null;
  }

  /** Splice tray / termination parking points (ready for future trays). */
  function hitTestTailTarget(clientX, clientY) {
    var list = document.elementsFromPoint
      ? document.elementsFromPoint(clientX, clientY)
      : [];
    var i;
    var el;
    var node;
    for (i = 0; i < list.length; i++) {
      el = list[i];
      node = el.closest && el.closest(
        '.lab-splice-point, [data-lab-splice], .lab-term-point, [data-lab-term]'
      );
      if (!node) continue;
      var rect = node.getBoundingClientRect();
      var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
      var label = node.getAttribute('data-lab-splice') ||
        node.getAttribute('data-lab-term') ||
        node.getAttribute('title') ||
        'Splice / Term';
      return {
        owner: node.hasAttribute('data-lab-term') || node.classList.contains('lab-term-point')
          ? 'termination'
          : 'splice',
        label: label,
        wx: pt.x,
        wy: pt.y,
        el: node,
        spliceId: node.getAttribute('data-lab-splice') || null,
        termId: node.getAttribute('data-lab-term') || null,
      };
    }
    return null;
  }

  function attachConnector(p, hit) {
    if (!p || !hit) return;
    if (hit.owner === 'ols') hit = enrichOlsHitDeepSeat(hit) || hit;
    var mismatch = isUniversalPortHit(hit) ? false : !polishMatch(p.polish, hit.polish);
    if (hit.owner === 'vfl' && global.FtthLab && typeof FtthLab.detachPcordsFromVfl === 'function') {
      FtthLab.detachPcordsFromVfl(hit.vflId, null, null);
    }
    var lockedRot = hit.owner === 'ols' ? 180 : resolveUprightPlugRotation(hit, p);
    if (hit.owner === 'ols' || hit.owner === 'opm' || hit.owner === 'vfl') lockedRot = 180;
    p.connector.attached = {
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
    if (isOtdrPortHit(hit)) {
      p.connector.attached.portId = hit.olsId || hit.opmId || hit.vflId || null;
      normalizeOtdrAttachmentFields(p.connector.attached);
    }
    p.connector.lockedRot = lockedRot;
    p.connector.liveRot = null;
    p.drawLockRot = null;
    p.connector.mismatch = mismatch;
    var bx = p.bx;
    var by = p.by;
    seatConnectorAtPort(p, hit.wx, hit.wy);
    p.bx = bx;
    p.by = by;
    if (typeof p.fixedLength !== 'number') {
      var tip = bootAnchor(p);
      p.fixedLength = Math.max(40, dist2(tip.x, tip.y, p.bx, p.by));
    }
    if (mismatch) showWarning(MISMATCH_MSG);
    if (hit.el) {
      hit.el.classList.add('is-plug-click');
      setTimeout(function () { hit.el.classList.remove('is-plug-click'); }, 280);
    }
    setStatus(
      'Connector locked · ' + displayPolish(p.polish) + ' → ' + hit.label +
      (mismatch ? ' · mismatch +' + MISMATCH_PENALTY_DB + ' dB' : '')
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
    refreshBudget();
  }

  function detachConnector(p) {
    if (!p) return;
    p.connector.attached = null;
    p.connector.mismatch = false;
    p.connector.lockedRot = null;
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
    refreshBudget();
  }

  function attachTail(p, hit) {
    if (!p || !hit) return;
    p.tail.attached = {
      owner: hit.owner,
      label: hit.label,
      spliceId: hit.spliceId,
      termId: hit.termId,
      wx: hit.wx,
      wy: hit.wy,
    };
    p.bx = hit.wx;
    p.by = hit.wy;
    if (hit.el) {
      hit.el.classList.add('is-tail-dock');
      setTimeout(function () { hit.el.classList.remove('is-tail-dock'); }, 280);
    }
    setStatus('Bare fiber parked · ' + hit.label);
  }

  function detachTail(p) {
    if (!p) return;
    p.tail.attached = null;
  }

  function syncAttached(p) {
    if (p.connector.attached) {
      var att = p.connector.attached;
      if (isOtdrAttachment(att)) {
        var pwOtdr = resolveOtdrPortWorld(att);
        if (pwOtdr) {
          att.wx = pwOtdr.x;
          att.wy = pwOtdr.y;
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwOtdr.x, pwOtdr.y);
        }
      } else if (att.owner === 'coupler' && global.FtthLab &&
          typeof FtthLab.getCouplerPortWorld === 'function') {
        var pw = FtthLab.getCouplerPortWorld(att.couplerId, att.port);
        if (pw) {
          att.wx = pw.x;
          att.wy = pw.y;
          if (typeof p.connector.lockedRot !== 'number') {
            p.connector.lockedRot = typeof pw.rot === 'number' ? pw.rot : portAlignedRotation(att);
          }
          seatConnectorAtPort(p, pw.x, pw.y);
        }
      } else if (att.owner === 'olt') {
        var el = document.querySelector(
          '.lab-fx-port[data-lab-slot="' + att.slot + '"][data-lab-sfp="' + att.oltPort + '"]'
        );
        if (el) {
          var cage = el.querySelector('.lab-fx-port__cage') || el;
          var rect = cage.getBoundingClientRect();
          var pt = clientToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
          att.wx = pt.x;
          att.wy = pt.y;
          seatConnectorAtPort(p, pt.x, pt.y);
        }
      } else if (att.owner === 'splitter') {
        var el2 = document.querySelector(
          '.lab-cas-port[data-spl-id="' + att.splitterId + '"][data-spl-port="' + att.port + '"]'
        );
        if (el2) {
          var face = el2.querySelector('i') || el2;
          var r2 = face.getBoundingClientRect();
          var pt2 = clientToWorld(r2.left + r2.width / 2, r2.top + r2.height / 2);
          att.wx = pt2.x;
          att.wy = pt2.y;
          seatConnectorAtPort(p, pt2.x, pt2.y);
        }
      } else if (att.owner === 'vfl') {
        var pwV = null;
        if (global.FtthLab && typeof FtthLab.getVflPortWorld === 'function') {
          pwV = FtthLab.getVflPortWorld(att.vflId);
        }
        if (pwV) {
          att.wx = pwV.x;
          att.wy = pwV.y;
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwV.x, pwV.y);
        }
      } else if (att.owner === 'opm') {
        var pwO = null;
        if (global.FtthLab && typeof FtthLab.getOpmPortWorld === 'function') {
          pwO = FtthLab.getOpmPortWorld(att.opmId);
        }
        if (pwO) {
          att.wx = pwO.x;
          att.wy = pwO.y;
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwO.x, pwO.y);
        }
      } else if (att.owner === 'ols') {
        var pwS = null;
        if (global.FtthLab && typeof FtthLab.getOlsPortWorld === 'function') {
          pwS = FtthLab.getOlsPortWorld(att.olsId);
        }
        if (pwS) {
          att.wx = pwS.x;
          att.wy = pwS.y;
          p.connector.lockedRot = 180;
          att.lockedRot = 180;
          p.connector.liveRot = null;
          seatConnectorAtPort(p, pwS.x, pwS.y);
        }
      }
    }
    if (p.tail.attached) {
      var tAtt = p.tail.attached;
      var sel = null;
      if (tAtt.spliceId) {
        sel = document.querySelector(
          '[data-lab-splice="' + tAtt.spliceId + '"], .lab-splice-point[data-lab-splice="' +
          tAtt.spliceId + '"]'
        );
      } else if (tAtt.termId) {
        sel = document.querySelector(
          '[data-lab-term="' + tAtt.termId + '"], .lab-term-point[data-lab-term="' +
          tAtt.termId + '"]'
        );
      }
      if (sel) {
        var tr = sel.getBoundingClientRect();
        var tp = clientToWorld(tr.left + tr.width / 2, tr.top + tr.height / 2);
        tAtt.wx = tp.x;
        tAtt.wy = tp.y;
        p.bx = tp.x;
        p.by = tp.y;
      } else if (typeof tAtt.wx === 'number') {
        p.bx = tAtt.wx;
        p.by = tAtt.wy;
      }
    }
  }

  /* ─── Path / render — continuous downward catenary (all states) ─── */

  function pigtailSlackFactor() {
    return (global.FtthLab && FtthLab.CATENARY_DEFAULT_SLACK) || PIGTAIL_CATENARY_SLACK;
  }

  /** Dense hanging samples between two world points (shared FtthLab sampler preferred). */
  function samplePigtailCatenary(p0, p3, length, count) {
    count = Math.max(2, count || PIGTAIL_CATENARY_SAMPLES);
    if (global.FtthLab && typeof FtthLab.sampleFiberCatenary === 'function') {
      return FtthLab.sampleFiberCatenary(p0, p3, length, count);
    }
    /* Parabolic hang fallback before patch-cord mounts (screen Y+ down). */
    var chord = dist2(p0.x, p0.y, p3.x, p3.y) || 1;
    var L = Math.max(length || chord * pigtailSlackFactor(), chord * 1.0002);
    var excess = Math.max(0, L - chord);
    var sag = Math.sqrt(Math.max(0, excess * chord * 0.5)) * 0.45;
    if (sag < 6) sag = Math.min(36, chord * 0.14);
    var pts = [];
    var i;
    for (i = 0; i < count; i++) {
      var t = count === 1 ? 0.5 : i / (count - 1);
      var x = p0.x + (p3.x - p0.x) * t;
      var y = p0.y + (p3.y - p0.y) * t + 4 * sag * t * (1 - t);
      pts.push({ x: x, y: y });
    }
    pts[0] = { x: p0.x, y: p0.y };
    pts[count - 1] = { x: p3.x, y: p3.y };
    return pts;
  }

  /**
   * Arc length for render: locked length, else traced route length, else natural slack.
   * Route / freehand ink never becomes the drawn polyline — only length / sag intent.
   */
  function resolvePigtailRenderLength(p, p0, tipB) {
    var chord = dist2(p0.x, p0.y, tipB.x, tipB.y) || 1;
    if (typeof p.fixedLength === 'number' && p.fixedLength > 0) {
      return Math.max(p.fixedLength, chord * 1.0002);
    }
    var hist = (p.pathHistory && p.pathHistory.length) ? p.pathHistory : p.route;
    if (hist && hist.length) {
      var poly = [{ x: p0.x, y: p0.y }].concat(hist).concat([{ x: tipB.x, y: tipB.y }]);
      var len = 0;
      var i;
      for (i = 1; i < poly.length; i++) {
        len += dist2(poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
      }
      return Math.max(len, chord * pigtailSlackFactor(), chord * 1.0002);
    }
    var slack = pigtailSlackFactor();
    var sagFn = global.FtthLab && FtthLab.fiberCatenarySagDepth;
    var lenFn = global.FtthLab && FtthLab.fiberCatenaryLengthForSag;
    if (typeof sagFn === 'function' && typeof lenFn === 'function') {
      return Math.max(chord * slack, lenFn(p0, tipB, sagFn(chord)));
    }
    return Math.max(chord * slack, chord * 1.0002);
  }

  function getRouteMode(p) {
    return p && p.routeMode === 'gravity' ? 'gravity' : 'snake';
  }

  function ensurePathHistory(p) {
    if (!p) return [];
    if (!Array.isArray(p.pathHistory)) {
      p.pathHistory = Array.isArray(p.route) ? p.route.slice() : [];
    }
    p.route = p.pathHistory;
    return p.pathHistory;
  }

  function syncPathAlias(p) {
    if (!p) return;
    ensurePathHistory(p);
    p.route = p.pathHistory;
  }

  function setJacketColor(id, colorName) {
    var p = findPigtail(id);
    if (!p) return;
    var next = normalizeJacketColorName(colorName);
    if (!FIBER_COLORS[next] || p.jacketColor === next) return;
    p.jacketColor = next;
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus((isCable(p) ? 'Cable' : 'Pigtail') + ' jacket · ' + next);
  }

  function setRouteMode(id, mode) {
    var p = findPigtail(id);
    if (!p) return;
    var targets = [p];
    if (isPigtailFused(p)) {
      var partner = getFusedPartner(p);
      if (partner) targets.push(partner);
    }
    var nextMode = mode === 'gravity' ? 'gravity' : 'snake';
    targets.forEach(function (pg) {
      pg.routeMode = nextMode;
      syncPathAlias(pg);
    });
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus(
      nextMode === 'snake'
        ? (targets.length > 1
          ? 'Fused assembly · Snake Route Mode'
          : 'Snake Route Mode · orthogonal L-ghost + filleted corners')
        : (targets.length > 1
          ? 'Fused assembly · Gravity Physics Mode'
          : 'Gravity Physics Mode · catenary sag')
    );
  }

  function strainReliefStart(p) {
    var tipA = bootAnchor(p);
    var tA = bootOutDir(getConnRot(p));
    var stub = Math.max(STRAIN_RELIEF_PX * 0.55, BOOT_EXIT_STUB);
    return {
      x: tipA.x + tA.x * stub,
      y: tipA.y + tA.y * stub,
    };
  }

  function collapseOrthoPts(pts) {
    var out = [];
    var i;
    for (i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (!pt) continue;
      if (
        out.length &&
        Math.abs(out[out.length - 1].x - pt.x) < 0.5 &&
        Math.abs(out[out.length - 1].y - pt.y) < 0.5
      ) {
        continue;
      }
      out.push({ x: pt.x, y: pt.y });
    }
    return out;
  }

  function orthoPolyline(p) {
    var tipB = { x: p.bx, y: p.by };
    var hist = ensurePathHistory(p);
    var ghost = p.snake && p.snake.ghost ? { x: p.snake.ghost.x, y: p.snake.ghost.y } : null;
    var dragA = !!(p.snake && p.snake.dragEnd === 'A');
    var start;
    if (isCable(p)) {
      start = { x: p.ax, y: p.ay };
      if (!hist.length && !ghost) {
        return collapseOrthoPts([start, tipB]);
      }
    } else {
      start = strainReliefStart(p);
    }
    var pts = [{ x: start.x, y: start.y }];
    var i;
    /* Ghost bend sits between the free tip and committed history (never in pathHistory). */
    if (ghost && dragA) pts.push(ghost);
    for (i = 0; i < hist.length; i++) {
      pts.push({ x: hist[i].x, y: hist[i].y });
    }
    if (ghost && !dragA) pts.push(ghost);
    pts.push(tipB);
    return collapseOrthoPts(pts);
  }

  function inferAxis(from, to) {
    if (!from || !to) return null;
    var dx = to.x - from.x;
    var dy = to.y - from.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    /* Prefer H-then-V ghost when axes are equal. */
    return Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  }

  /**
   * Preview L-bend from locked vertex → cursor (not committed).
   * Primary axis picks the first leg so we never invert into a Z-stair.
   * axis 'h' → horizontal then vertical; 'v' → vertical then horizontal.
   */
  function ghostBendFrom(last, cursorX, cursorY, axis) {
    if (!last || !axis) return null;
    var dx = cursorX - last.x;
    var dy = cursorY - last.y;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    if (axis === 'h') {
      if (Math.abs(dy) < 0.5) return null;
      return { x: cursorX, y: last.y };
    }
    if (Math.abs(dx) < 0.5) return null;
    return { x: last.x, y: cursorY };
  }

  function commitGhostCorner(corners, last, ghost, atFront) {
    if (!ghost || !last) return last;
    if (dist2(last.x, last.y, ghost.x, ghost.y) < ORTHO_MIN_SEG) return last;
    if (atFront) corners.unshift({ x: ghost.x, y: ghost.y });
    else corners.push({ x: ghost.x, y: ghost.y });
    return { x: ghost.x, y: ghost.y };
  }

  /** Dominant axis from last locked point → cursor (recomputed every move). */
  function primaryAxisFromDelta(dx, dy) {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return null;
    return Math.abs(dx) >= Math.abs(dy) ? 'h' : 'v';
  }

  /**
   * Pop committed corners while the cursor retreats back along the route.
   * Returns the new hinge/last point after any unrolls.
   */
  function backtrackCorners(corners, anchor, cursorX, cursorY, atFront) {
    var guard = 0;
    while (corners.length && guard++ < 64) {
      var last = atFront ? corners[0] : corners[corners.length - 1];
      var prev = atFront
        ? (corners.length > 1 ? corners[1] : anchor)
        : (corners.length > 1 ? corners[corners.length - 2] : anchor);

      var inDx = last.x - prev.x;
      var inDy = last.y - prev.y;
      var inLen = Math.sqrt(inDx * inDx + inDy * inDy) || 1;
      var outDx = cursorX - last.x;
      var outDy = cursorY - last.y;
      /* Positive along = continuing past the corner in the arrival direction. */
      var along = (outDx * inDx + outDy * inDy) / inLen;
      var perp = (outDx * (-inDy) + outDy * inDx) / inLen;
      var dLast = Math.sqrt(outDx * outDx + outDy * outDy);

      var pastCorner = along < -ORTHO_BACKTRACK_PX && Math.abs(perp) <= Math.max(ORTHO_TURN_PX * 2, 24);
      var onCornerBacking =
        dLast <= ORTHO_TURN_PX && along < 0 && Math.abs(perp) <= ORTHO_TURN_PX * 2;

      if (!pastCorner && !onCornerBacking) break;

      if (atFront) corners.shift();
      else corners.pop();
    }
    if (atFront) {
      return corners.length ? corners[0] : anchor;
    }
    return corners.length ? corners[corners.length - 1] : anchor;
  }

  /**
   * Aim connector boot / ferrule along the active travel segment.
   * Bare-tip rotation is derived in tailStyle from the last path segment.
   */
  function alignEndsToTravel(p, dragEnd) {
    if (!p) return;
    if (dragEnd === 'A') {
      var hinge = (p.pathHistory && p.pathHistory.length)
        ? p.pathHistory[0]
        : { x: p.bx, y: p.by };
      /* Ferrule leads outward along travel (hinge → connector). */
      var lead = headingRotFromMotion(p.ax - hinge.x, p.ay - hinge.y);
      p.drawLockRot = lead;
      p.connector.liveRot = lead;
      return;
    }
    if (p.connector.attached) return;
    var first = (p.pathHistory && p.pathHistory.length)
      ? p.pathHistory[0]
      : { x: p.bx, y: p.by };
    var bootAim = endRotationDeg(p.ax, p.ay, first.x, first.y);
    p.drawLockRot = bootAim;
    p.connector.liveRot = bootAim;
  }

  /**
   * SVG path for orthogonal polyline with smooth quadratic fillets at corners.
   */
  function filletOrthoSvg(pts, radius) {
    pts = collapseOrthoPts(pts);
    if (pts.length < 2) return '';
    if (pts.length === 2) {
      return 'M ' + pts[0].x + ' ' + pts[0].y + ' L ' + pts[1].x + ' ' + pts[1].y;
    }
    var rMax = Math.max(8, Math.min(24, radius != null ? radius : ORTHO_FILLET_R));
    var d = 'M ' + pts[0].x + ' ' + pts[0].y;
    var i;
    for (i = 1; i < pts.length - 1; i++) {
      var prev = pts[i - 1];
      var mid = pts[i];
      var next = pts[i + 1];
      var v1x = mid.x - prev.x;
      var v1y = mid.y - prev.y;
      var v2x = next.x - mid.x;
      var v2y = next.y - mid.y;
      var len1 = Math.sqrt(v1x * v1x + v1y * v1y) || 1;
      var len2 = Math.sqrt(v2x * v2x + v2y * v2y) || 1;
      var r = Math.min(rMax, len1 * 0.5, len2 * 0.5);
      if (r < 2) {
        d += ' L ' + mid.x + ' ' + mid.y;
        continue;
      }
      var before = {
        x: mid.x - (v1x / len1) * r,
        y: mid.y - (v1y / len1) * r,
      };
      var after = {
        x: mid.x + (v2x / len2) * r,
        y: mid.y + (v2y / len2) * r,
      };
      d += ' L ' + before.x + ' ' + before.y;
      d += ' Q ' + mid.x + ' ' + mid.y + ' ' + after.x + ' ' + after.y;
    }
    var last = pts[pts.length - 1];
    d += ' L ' + last.x + ' ' + last.y;
    return d;
  }

  /**
   * Begin / continue orthogonal snake from either end.
   * Never clears pathHistory — continues recorded vertices.
   */
  function beginOrthoSnake(p, dragEnd) {
    ensurePathHistory(p);
    dragEnd = dragEnd === 'A' ? 'A' : 'B';
    var hist = p.pathHistory;
    var startA = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };

    if (dragEnd === 'B') {
      if (typeof p.drawLockRot !== 'number') {
        p.drawLockRot = getConnRot(p);
      }
      p.connector.liveRot = p.drawLockRot;
      var lastB = hist.length ? hist[hist.length - 1] : startA;
      p.snake = {
        dragEnd: 'B',
        corners: hist.slice(),
        axis: null,
        ghost: null,
        pin: { x: p.ax, y: p.ay },
      };
      /* Seed axis from current tip so the first move stays on the spawn axis. */
      p.snake.axis = inferAxis(lastB, tipB);
    } else {
      var hingeA = hist.length ? hist[0] : tipB;
      p.snake = {
        dragEnd: 'A',
        corners: hist.slice(),
        axis: null,
        ghost: null,
        pinB: { x: p.bx, y: p.by },
      };
      p.snake.axis = inferAxis(hingeA, { x: p.ax, y: p.ay });
    }
  }

  /**
   * Adaptive primary-axis routing while dragging tip B.
   * Dominant H/V each frame — no sticky inverted Z-stair.
   * Backtracking pops corners when retreating along the route.
   */
  function updateOrthoSnake(p, cursorX, cursorY) {
    if (!p.snake) beginOrthoSnake(p, 'B');
    if (p.snake.dragEnd === 'A') {
      updateOrthoSnakeFromA(p, cursorX, cursorY);
      return;
    }

    p.ax = p.snake.pin.x;
    p.ay = p.snake.pin.y;

    var start = strainReliefStart(p);
    var corners = p.snake.corners;
    var last = backtrackCorners(corners, start, cursorX, cursorY, false);

    var dx = cursorX - last.x;
    var dy = cursorY - last.y;
    var axis = primaryAxisFromDelta(dx, dy);
    p.snake.axis = axis;

    if (!axis) {
      p.bx = last.x;
      p.by = last.y;
      p.snake.ghost = null;
      p.pathHistory = corners.slice();
      syncPathAlias(p);
      alignEndsToTravel(p, 'B');
      return;
    }

    if (axis === 'h') {
      /*
       * Predominantly horizontal: extend straight to mouseX (no vertical stair).
       * Tip rides the horizontal rail; secondary dy beyond threshold commits a corner.
       */
      if (Math.abs(dy) > ORTHO_TURN_PX) {
        var bendH = { x: cursorX, y: last.y };
        last = commitGhostCorner(corners, last, bendH, false);
        p.bx = last.x;
        p.by = cursorY;
        p.snake.axis = 'v';
        p.snake.ghost = null;
      } else {
        p.bx = cursorX;
        p.by = last.y;
        p.snake.ghost = null;
      }
    } else {
      /* Predominantly vertical: extend straight to mouseY. */
      if (Math.abs(dx) > ORTHO_TURN_PX) {
        var bendV = { x: last.x, y: cursorY };
        last = commitGhostCorner(corners, last, bendV, false);
        p.bx = cursorX;
        p.by = last.y;
        p.snake.axis = 'h';
        p.snake.ghost = null;
      } else {
        p.bx = last.x;
        p.by = cursorY;
        p.snake.ghost = null;
      }
    }

    p.pathHistory = corners.slice();
    syncPathAlias(p);
    alignEndsToTravel(p, 'B');
  }

  function updateOrthoSnakeFromA(p, cursorX, cursorY) {
    p.bx = p.snake.pinB.x;
    p.by = p.snake.pinB.y;

    var tipB = { x: p.bx, y: p.by };
    var corners = p.snake.corners;
    var hinge = backtrackCorners(corners, tipB, cursorX, cursorY, true);

    var dx = cursorX - hinge.x;
    var dy = cursorY - hinge.y;
    var axis = primaryAxisFromDelta(dx, dy);
    p.snake.axis = axis;

    if (!axis) {
      p.ax = hinge.x;
      p.ay = hinge.y;
      p.snake.ghost = null;
      p.pathHistory = corners.slice();
      syncPathAlias(p);
      alignEndsToTravel(p, 'A');
      return;
    }

    if (axis === 'h') {
      if (Math.abs(dy) > ORTHO_TURN_PX) {
        var bendH = { x: cursorX, y: hinge.y };
        hinge = commitGhostCorner(corners, hinge, bendH, true);
        p.ax = hinge.x;
        p.ay = cursorY;
        p.snake.axis = 'v';
        p.snake.ghost = null;
      } else {
        p.ax = cursorX;
        p.ay = hinge.y;
        p.snake.ghost = null;
      }
    } else if (Math.abs(dx) > ORTHO_TURN_PX) {
      var bendV = { x: hinge.x, y: cursorY };
      hinge = commitGhostCorner(corners, hinge, bendV, true);
      p.ax = cursorX;
      p.ay = hinge.y;
      p.snake.axis = 'h';
      p.snake.ghost = null;
    } else {
      p.ax = hinge.x;
      p.ay = cursorY;
      p.snake.ghost = null;
    }

    p.pathHistory = corners.slice();
    syncPathAlias(p);
    alignEndsToTravel(p, 'A');
  }

  function endOrthoSnake(p) {
    if (!p) return;
    if (p.snake && p.snake.corners) {
      var corners = p.snake.corners.slice();
      var ghost = p.snake.ghost;
      /* Lock remaining L-bend so release never leaves a diagonal elastic segment. */
      if (ghost) {
        if (p.snake.dragEnd === 'A') {
          var hinge = corners.length ? corners[0] : { x: p.bx, y: p.by };
          commitGhostCorner(corners, hinge, ghost, true);
        } else {
          var start = strainReliefStart(p);
          var last = corners.length ? corners[corners.length - 1] : start;
          commitGhostCorner(corners, last, ghost, false);
        }
      }
      p.pathHistory = corners;
    }
    syncPathAlias(p);
    p.snake = null;
    var startLen = strainReliefStart(p);
    var poly = [{ x: startLen.x, y: startLen.y }]
      .concat(p.pathHistory || [])
      .concat([{ x: p.bx, y: p.by }]);
    var len = 0;
    var i;
    for (i = 1; i < poly.length; i++) {
      len += dist2(poly[i - 1].x, poly[i - 1].y, poly[i].x, poly[i].y);
    }
    p.fixedLength = Math.max(40, len);
    clampStripFrontiersToPath(p);
  }

  function usesOrthoRoute(p) {
    /* Snake mode is always orthogonal (incl. horizontal spawn with empty hist). */
    return !!(p && getRouteMode(p) === 'snake');
  }

  function moveTipGravity(p, dragEnd, cursorX, cursorY) {
    if (dragEnd === 'A') {
      p.ax = cursorX;
      p.ay = cursorY;
      /* Instant heading — no lerp damping */
      p.connector.liveRot = endRotationDeg(p.ax, p.ay, p.bx, p.by);
      p.drawLockRot = null;
    } else {
      p.bx = cursorX;
      p.by = cursorY;
    }
  }

  /**
   * Fiber path: snake (ortho + fillets) or gravity catenary per routeMode.
   * pathHistory is always preserved regardless of render mode.
   * Active snake.ghost is included as an L-preview bend (not stored until commit).
   */
  function fiberPath(p) {
    if (isCable(p)) {
      var cablePts = fiberRenderPathPoints(p);
      if (!cablePts || cablePts.length < 2) {
        return 'M ' + p.ax + ' ' + p.ay + ' L ' + p.bx + ' ' + p.by;
      }
      return fiberSvgPathFromRenderPoints(p, cablePts) || svgPathFromPoints(cablePts);
    }
    var tipA = bootAnchor(p);
    var p0 = strainReliefStart(p);
    var tipB = { x: p.bx, y: p.by };
    ensurePathHistory(p);

    if (usesOrthoRoute(p)) {
      var pts = orthoPolyline(p);
      if (
        !pts.length ||
        Math.abs(pts[0].x - p0.x) > 0.5 ||
        Math.abs(pts[0].y - p0.y) > 0.5
      ) {
        pts = [{ x: p0.x, y: p0.y }].concat(pts);
        pts = collapseOrthoPts(pts);
      }
      var body = filletOrthoSvg(pts, ORTHO_FILLET_R);
      var rest = String(body || '')
        .replace(/^M\s*[-+]?[\d.]+(?:e[-+]?\d+)?\s+[-+]?[\d.]+(?:e[-+]?\d+)?/i, '')
        .trim();
      return (
        'M ' + tipA.x + ' ' + tipA.y +
        ' L ' + p0.x + ' ' + p0.y +
        (rest ? ' ' + rest : '')
      );
    }

    var L = resolvePigtailRenderLength(p, p0, tipB);
    var mid = samplePigtailCatenary(p0, tipB, L, PIGTAIL_CATENARY_SAMPLES);
    var d = 'M ' + tipA.x + ' ' + tipA.y + ' L ' + p0.x + ' ' + p0.y;
    var i;
    for (i = 1; i < mid.length - 1; i++) {
      d += ' L ' + mid[i].x + ' ' + mid[i].y;
    }
    d += ' L ' + tipB.x + ' ' + tipB.y;
    return d;
  }

  /** Dashed L-bend overlay for the uncommitted ghost segment only. */
  function ghostPreviewPath(p) {
    if (!p || !p.snake || !p.snake.ghost) return '';
    var ghost = { x: p.snake.ghost.x, y: p.snake.ghost.y };
    var pts;
    if (p.snake.dragEnd === 'A') {
      var startA = strainReliefStart(p);
      var hinge = p.pathHistory.length
        ? { x: p.pathHistory[0].x, y: p.pathHistory[0].y }
        : { x: p.bx, y: p.by };
      pts = [startA, ghost, hinge];
    } else {
      var startB = strainReliefStart(p);
      var last = p.pathHistory.length
        ? {
            x: p.pathHistory[p.pathHistory.length - 1].x,
            y: p.pathHistory[p.pathHistory.length - 1].y,
          }
        : startB;
      pts = [last, ghost, { x: p.bx, y: p.by }];
    }
    return filletOrthoSvg(collapseOrthoPts(pts), ORTHO_FILLET_R);
  }

  function connectorStyle(p) {
    var rot = getConnRot(p);
    return (
      'left:' + Math.round(p.ax - END_W / 2) + 'px;' +
      'top:' + Math.round(p.ay - END_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function cableEndStyle(p, end) {
    end = cableEndFromToken(end);
    var rot;
    var tip = cableEndTipWorld(p, end);
    var other = cableEndFromToken(end) === 'start' ? { x: p.bx, y: p.by } : { x: p.ax, y: p.ay };
    if ((end === 'start' && p.startIsSnappedToCleaver) || (end === 'end' && p.isSnappedToCleaver)) {
      rot = 0;
    } else if (usesOrthoRoute(p)) {
      var pts = orthoPolyline(p);
      if (pts.length >= 2) {
        var a;
        var b;
        if (end === 'start') {
          a = pts[0];
          b = pts[1];
        } else {
          a = pts[pts.length - 2];
          b = pts[pts.length - 1];
        }
        rot = headingRotFromMotion(b.x - a.x, b.y - a.y);
      } else {
        rot = headingRotFromMotion(other.x - tip.x, other.y - tip.y);
      }
    } else {
      rot = end === 'start'
        ? headingRotFromMotion(other.x - tip.x, other.y - tip.y) + 180
        : headingRotFromMotion(other.x - tip.x, other.y - tip.y) + 180;
    }
    return (
      'left:' + Math.round(tip.x - TAIL_W / 2) + 'px;' +
      'top:' + Math.round(tip.y - TAIL_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function buildCableSleeveHtml(p, end) {
    if (!pigtailEndHasSleeve(p, end)) return '';
    return (
      '<div class="lab-pigtail-sleeve lab-sleeve-tube" data-pt-sleeve="' + fiberTargetId(p, end) +
      '" style="' + sleeveStyle(p, end) +
      '" title="Sleeve 60mm · drag along fiber" aria-label="Splice protection sleeve"></div>'
    );
  }

  function buildCableTailButtonHtml(p, end) {
    end = cableEndFromToken(end);
    syncCablePrepState(p);
    var prep = cableEndPrepState(p, end);
    var selected = selection.id === p.id ? ' is-selected' : '';
    var fs = ensureCableEndStrip(p, end);
    var j = fs.jacketTo || 0;
    var fullyStripped = prep.stripped && (getCableEndStripStage(p, end) >= 2 || prep.cleaved);
    var bareComplete = fullyStripped || isBareStripComplete(fs);
    var jacketStripped = prep.stripped || j > STRIP_TIP_EPS;
    var stripStage = getCableEndStripStage(p, end);
    var peel = fs.peel || 0;
    var peelLayer = fs.peelLayer;
    var cleaved = prep.cleaved || isCableEndCleaved(p, end);
    var snappedCleaver = end === 'start' ? p.startIsSnappedToCleaver : p.isSnappedToCleaver;
    var snappedSplicer = cableEndSnappedToSplicer(p, end);
    var label = end === 'start' ? 'A' : 'B';
    var jacketCapStyle = 'background:' + getJacketColorHex(p) + ';';
    return (
      '<button type="button" class="lab-pigtail__tail lab-cable__end' +
      (snappedCleaver ? ' is-cleaver-docked' : '') +
      (snappedSplicer ? ' is-splicer-docked' : '') +
      (cleaved ? ' is-cleaved' : '') +
      (jacketStripped ? ' is-strip-stage1' : '') +
      (bareComplete ? ' is-strip-stage2' : '') +
      (peel > 0.02 ? ' is-strip-peeling' : '') +
      '" data-pt-id="' + p.id + '" data-pt-end="' + label + '" data-cable-end="' + end +
      '" style="' + cableEndStyle(p, end) + ';--strip-peel:' + peel.toFixed(3) + ';" ' +
      'title="Bare fiber · ' + stripStageLabel(stripStage) + '" aria-label="Bare fiber ' + label + '">' +
      '<span class="lab-pigtail__jacket' + (jacketStripped ? ' is-strip-removed' : '') +
      (peel > 0.02 && peelLayer === 'jacket' ? ' is-strip-peeling' : '') +
      '" style="' + jacketCapStyle + '" aria-hidden="true"></span>' +
      '<span class="lab-pigtail__buffer' +
      (fullyStripped ? ' is-strip-removed' : (jacketStripped && !bareComplete ? ' is-strip-exposed' : ' is-strip-jacketed')) +
      (bareComplete ? ' is-strip-removed' : '') +
      (peel > 0.02 && peelLayer === 'buffer' ? ' is-strip-peeling' : '') +
      '" aria-hidden="true"></span>' +
      '<span class="lab-pigtail__cleave' +
      (bareComplete ? ' is-strip-bare' : '') +
      (jacketStripped && !bareComplete ? ' is-strip-buffered' : '') +
      (cleaved ? ' is-cleaved' : '') + '" aria-hidden="true"></span>' +
      '<span class="lab-vfl-exit-flare lab-vfl-exit-flare--tail" aria-hidden="true">' +
      '<i class="lab-vfl-exit-flare__aura"></i><i class="lab-vfl-exit-flare__hot"></i></span>' +
      '</button>'
    );
  }

  function tailStyle(p) {
    var rot;
    if (p.isSnappedToCleaver) {
      rot = 0;
    } else if (usesOrthoRoute(p)) {
      var pts = orthoPolyline(p);
      if (pts.length >= 2) {
        var a = pts[pts.length - 2];
        var b = pts[pts.length - 1];
        /* Cleave leads along travel (prev → tip). */
        rot = headingRotFromMotion(b.x - a.x, b.y - a.y);
      } else {
        rot = headingRotFromMotion(p.bx - p.ax, p.by - p.ay);
      }
    } else {
      /* Buffer faces connector; cleave faces away */
      rot = endRotationDeg(p.bx, p.by, p.ax, p.ay) + 180;
    }
    return (
      'left:' + Math.round(p.bx - TAIL_W / 2) + 'px;' +
      'top:' + Math.round(p.by - TAIL_H / 2) + 'px;' +
      'transform-origin:50% 50%;' +
      'transform:rotate(' + rot.toFixed(2) + 'deg)'
    );
  }

  function ensureLayer() {
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'lab-pigtail-layer';
      layer.setAttribute('data-lab-pigtail-layer', '1');
    }
    if (layer.parentNode !== mount) {
      mount.appendChild(layer);
    } else if (layer !== mount.lastElementChild) {
      /* Paint after cleaver/other bench tools so fiber stays on the ruler visually */
      mount.appendChild(layer);
    }
    return layer;
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    pigtails.forEach(syncAttached);
    pigtails.forEach(syncPigtailFiberLength);

    var html =
      '<svg class="lab-pigtail-svg" aria-hidden="true">' +
      '<defs>' +
      '<filter id="lab-vfl-core-beam-pt" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feGaussianBlur in="SourceGraphic" stdDeviation="0.55" result="blur"/>' +
      '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' +
      '</defs>';
    pigtails.forEach(function (p) {
      html += buildPigtailFiberSvg(p);
    });
    Object.keys(fusedAssemblies).forEach(function (mid) {
      if (!shouldRenderFusedBridgeInMainLayer(mid)) return;
      html += buildFusedAssemblyUnifiedSvg(mid);
    });
    html += '</svg>';

    pigtails.forEach(function (p) {
      var selected = selection.id === p.id ? ' is-selected' : '';
      if (isCable(p)) {
        syncCablePrepState(p);
        html +=
          '<div class="lab-pigtail lab-cable' + selected + '" data-pt-node="' + p.id + '" data-cable-node="' + p.id + '">' +
          buildCableTailButtonHtml(p, 'start') +
          buildCableTailButtonHtml(p, 'end') +
          buildCableSleeveHtml(p, 'start') +
          buildCableSleeveHtml(p, 'end') +
          '</div>';
        return;
      }
      ensureFiberStrip(p);
      var fs = p.fiberStrip;
      var j = fs.jacketTo || 0;
      var fullyStripped = isFullyStrippedPigtail(p);
      var bareComplete = fullyStripped || isBareStripComplete(fs);
      var jacketStripped = j > STRIP_TIP_EPS;
      var stripStage = p.stripStage || 0;
      var peel = fs.peel || 0;
      var peelLayer = fs.peelLayer;
      var jacketCapStyle = 'background:' + getJacketColorHex(p) + ';';
      html +=
        '<div class="lab-pigtail' + selected + '" data-pt-node="' + p.id + '">' +
        '<button type="button" class="lab-pigtail__conn lab-pcord__end ' +
        (normalizePolish(p.polish) === 'APC' ? 'is-apc' : 'is-pc') +
        (p.connector.attached ? ' is-attached' : '') +
        (p.connector.mismatch ? ' is-mismatch' : '') +
        '" data-pt-id="' + p.id + '" data-pt-end="A" style="' + connectorStyle(p) + '" ' +
        'title="SC connector · ' + displayPolish(p.polish) +
        (p.connector.attached ? ' · plugged' : ' · drag to port') + '" ' +
        'aria-label="SC pigtail connector">' +
        '<span class="lab-pcord__housing" aria-hidden="true"><i class="lab-pcord__ferrule"></i></span>' +
        '<span class="lab-pcord__boot" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>' +
        '<span class="lab-vfl-exit-flare" aria-hidden="true">' +
        '<i class="lab-vfl-exit-flare__aura"></i>' +
        '<i class="lab-vfl-exit-flare__hot"></i>' +
        '</span>' +
        '<b class="lab-pcord__mark">A</b>' +
        '</button>' +
        '<button type="button" class="lab-pigtail__tail' +
        (p.tail.attached ? ' is-attached' : '') +
        (p.isSnappedToCleaver ? ' is-cleaver-docked' : '') +
        (p.isSnappedToSplicer ? ' is-splicer-docked' : '') +
        (isPigtailFused(p) ? ' is-fused-assembly' : '') +
        (p.isCleaved || p.cleaved ? ' is-cleaved' : '') +
        (jacketStripped ? ' is-strip-stage1' : '') +
        (bareComplete ? ' is-strip-stage2' : '') +
        (peel > 0.02 ? ' is-strip-peeling' : '') +
        '" data-pt-id="' + p.id + '" data-pt-end="B" style="' + tailStyle(p) +
        ';--strip-peel:' + peel.toFixed(3) + ';" ' +
        'title="Bare fiber · ' + stripStageLabel(stripStage) + '" aria-label="Bare fiber tail">' +
        '<span class="lab-pigtail__jacket' +
        (jacketStripped ? ' is-strip-removed' : '') +
        (peel > 0.02 && peelLayer === 'jacket' ? ' is-strip-peeling' : '') +
        '" style="' + jacketCapStyle + '" aria-hidden="true"></span>' +
        '<span class="lab-pigtail__buffer' +
        (fullyStripped ? ' is-strip-removed' : (jacketStripped && !bareComplete ? ' is-strip-exposed' : ' is-strip-jacketed')) +
        (bareComplete ? ' is-strip-removed' : '') +
        (peel > 0.02 && peelLayer === 'buffer' ? ' is-strip-peeling' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="lab-pigtail__cleave' +
        (bareComplete ? ' is-strip-bare' : '') +
        (jacketStripped && !bareComplete ? ' is-strip-buffered' : '') +
        (p.cleaved || p.isCleaved ? ' is-cleaved' : '') +
        '" aria-hidden="true"></span>' +
        '<span class="lab-vfl-exit-flare lab-vfl-exit-flare--tail" aria-hidden="true">' +
        '<i class="lab-vfl-exit-flare__aura"></i>' +
        '<i class="lab-vfl-exit-flare__hot"></i>' +
        '</span>' +
        '</button>' +
        (p.hasSleeve
          ? '<div class="lab-pigtail-sleeve lab-sleeve-tube" data-pt-sleeve="' + p.id + '" style="' +
            sleeveStyle(p, 'end') + '" title="Sleeve 60mm · drag along fiber" aria-label="Splice protection sleeve"></div>'
          : '') +
        '</div>';
    });

    host.innerHTML = html;
    bindLayerEvents(host);
    pigtails.forEach(function (p) {
      if (!p.isSnappedToCleaver || !p.snappedCleaverId) return;
      var dockInfo = getCleaverSlotGeometry(p.snappedCleaverId);
      var dockGuide = cleaverSlotGuideFromInfo(dockInfo);
      if (dockGuide) setCleaverGuideLine(dockGuide, true);
      if (dockInfo) setCleaverRulerWallGuide(dockInfo, true);
    });
    reapplyStoredVflGlow();
    renderSplicerFiberOverlays();
  }

  function updateFiberPath(p) {
    if (!layer) return;
    if (!isCable(p) && (isFullyStrippedPigtail(p) || p.stripFrontierLock)) {
      restorePermanentStripFrontier(p);
    }
    syncPigtailFiberLength(p);
    if (isCable(p)) {
      syncCablePrepState(p);
      restoreCableEndStripFrontier(p, 'start');
      restoreCableEndStripFrontier(p, 'end');
    }
    replacePigtailFiberSvg(p);
    var aBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="A"]');
    var bBtn = layer.querySelector('[data-pt-id="' + p.id + '"][data-pt-end="B"]');
    if (isCable(p)) {
      if (cableEndIsSnappedToCleaver(p, 'start') && isCableEndCleaved(p, 'start')) {
        enforceCleavedJacketWallForEnd(p, 'start');
      }
      if (cableEndIsSnappedToCleaver(p, 'end') && isCableEndCleaved(p, 'end')) {
        enforceCleavedJacketWallForEnd(p, 'end');
      }
      if (aBtn) {
        var startFs = ensureCableEndStrip(p, 'start');
        var startStage = getCableEndStripStage(p, 'start');
        aBtn.setAttribute('style', cableEndStyle(p, 'start') + ';--strip-peel:' + (startFs.peel || 0).toFixed(3) + ';');
        aBtn.classList.toggle('is-strip-stage1', startStage >= 1);
        aBtn.classList.toggle('is-strip-stage2', startStage >= 2);
        aBtn.classList.toggle('is-cleaver-docked', !!p.startIsSnappedToCleaver);
        aBtn.classList.toggle('is-splicer-docked', !!p.startIsSnappedToSplicer);
      }
      if (bBtn) {
        var endFs = ensureCableEndStrip(p, 'end');
        var endStage = getCableEndStripStage(p, 'end');
        bBtn.setAttribute('style', cableEndStyle(p, 'end') + ';--strip-peel:' + (endFs.peel || 0).toFixed(3) + ';');
        bBtn.classList.toggle('is-strip-stage1', endStage >= 1);
        bBtn.classList.toggle('is-strip-stage2', endStage >= 2);
        bBtn.classList.toggle('is-cleaver-docked', !!p.isSnappedToCleaver);
        bBtn.classList.toggle('is-splicer-docked', !!p.isSnappedToSplicer);
      }
      ['start', 'end'].forEach(function (cableEnd) {
        var sleeveId = fiberTargetId(p, cableEnd);
        var sleeveEl = layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + sleeveId + '"]');
        if (pigtailEndHasSleeve(p, cableEnd)) {
          if (sleeveEl) {
            updateSleeveElement(p, sleeveEl, cableEnd);
          } else {
            var hostNode = layer.querySelector('[data-pt-node="' + p.id + '"]');
            if (hostNode) {
              var wrapEl = document.createElement('div');
              wrapEl.className = 'lab-pigtail-sleeve lab-sleeve-tube';
              wrapEl.setAttribute('data-pt-sleeve', sleeveId);
              wrapEl.setAttribute('style', sleeveStyle(p, cableEnd));
              wrapEl.setAttribute('title', 'Sleeve 60mm');
              hostNode.appendChild(wrapEl);
            }
          }
        } else if (sleeveEl && sleeveEl.parentNode) {
          sleeveEl.parentNode.removeChild(sleeveEl);
        }
      });
      return;
    }
    if (aBtn) aBtn.setAttribute('style', connectorStyle(p));
    if (bBtn) {
      var stripStage = p.stripStage || 0;
      bBtn.setAttribute(
        'style',
        tailStyle(p) + ';--strip-peel:' + (p.stripPeel || 0).toFixed(3) + ';'
      );
      bBtn.classList.toggle('is-strip-stage1', stripStage >= 1);
      bBtn.classList.toggle('is-strip-stage2', stripStage >= 2);
      bBtn.classList.toggle('is-cleaver-docked', !!p.isSnappedToCleaver);
      bBtn.classList.toggle('is-splicer-docked', !!p.isSnappedToSplicer);
    }
    var sleeve = layer.querySelector('.lab-pigtail-sleeve[data-pt-sleeve="' + p.id + '"]');
    if (p.hasSleeve) {
      if (sleeve) {
        updateSleeveElement(p, sleeve, 'end');
      } else {
        var hostNode = layer.querySelector('[data-pt-node="' + p.id + '"]');
        if (hostNode) {
          var wrapEl = document.createElement('div');
          wrapEl.className = 'lab-pigtail-sleeve lab-sleeve-tube';
          wrapEl.setAttribute('data-pt-sleeve', p.id);
          wrapEl.setAttribute('style', sleeveStyle(p, 'end'));
          wrapEl.setAttribute('title', 'Sleeve 60mm');
          hostNode.appendChild(wrapEl);
        }
      }
    } else if (sleeve && sleeve.parentNode) {
      sleeve.parentNode.removeChild(sleeve);
    }
  }

  function clearPlugHighlights() {
    document.querySelectorAll(
      '.lab-fx-port.is-plug-target, .lab-cas-port.is-plug-target, .lab-cpl-port.is-plug-target, ' +
      '.lab-vfl-port.is-plug-target, .lab-opm-port.is-plug-target, .lab-ols-port.is-plug-target, .lab-otdr-port.is-plug-target, .lab-splice-point.is-plug-target, .lab-term-point.is-plug-target, ' +
      '[data-lab-splice].is-plug-target, [data-lab-term].is-plug-target'
    ).forEach(function (n) { n.classList.remove('is-plug-target'); });
  }

  function highlightPort(el) {
    clearPlugHighlights();
    if (el) el.classList.add('is-plug-target');
  }

  function startPigtailBodyDrag(p, e) {
    if (!p) return;
    var activeEnd = resolveBodyDragActiveEnd(p, e.clientX, e.clientY);
    if (isCable(p)) {
      p.activeCableEnd = activeEnd;
      selectCable(p.id);
    } else {
      selectPigtail(p.id);
    }
    var blockedMsg = ovenDragBlockedMessage(p, activeEnd);
    if (blockedMsg) {
      setStatus(blockedMsg);
      return;
    }
    if (!isCable(p) && !isMemberEndFused(p, 'end') && p.connector.attached && p.tail.attached) {
      setStatus('Both ends parked · drag connector or bare tip to move');
      return;
    }
    if (!isCable(p) && !isMemberEndFused(p, 'end') && (p.connector.attached || p.tail.attached)) {
      setStatus('Drag the free end (connector or bare tip)');
      return;
    }

    var dragCtx = beginFusedRigidDrag(p, e.clientX, e.clientY);
    activeEnd = dragCtx.activeEnd || activeEnd;

    document.body.classList.add('lab-pigtail-dragging');
    if (dragCtx.fusedMachineId) setFusedAssemblyDragPassthrough(p, true, activeEnd);
    else setPigtailDragPassthrough(p, true);

    var moved = false;
    var magnetTarget = null;

    function onMove(ev) {
      moved = true;
      applyFusedRigidDrag(p, dragCtx, ev.clientX, ev.clientY);
      magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, null);
      if (magnetTarget && cableEndIsSnappedToSplicer(p, magnetTarget.end)) {
        var splicerId = magnetTarget.end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
        if (splicerId) renderSplicerFiberOverlays(splicerId);
      }
    }

    function onUp(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.classList.remove('lab-pigtail-dragging');
      if (dragCtx.fusedMachineId) setFusedAssemblyDragPassthrough(p, false, activeEnd);
      else setPigtailDragPassthrough(p, false);

      var seated = finishSplicerMagnetOnDropForTarget(p, ev.clientX, ev.clientY, null, magnetTarget);
      if (!seated) {
        if (activeEnd === 'start') p.startSplicerPreviewSlot = null;
        else p.splicerPreviewSlot = null;
        var otherEnd = isCable(p) ? otherCableEnd(activeEnd) : null;
        if (otherEnd === 'start') p.startSplicerPreviewSlot = null;
        else if (otherEnd === 'end') p.splicerPreviewSlot = null;
      }
      if (activeEnd === 'start') p.startSplicerDragDetached = false;
      else p.splicerDragDetached = false;
      clearSplicerMagnetHighlight();
      clearSplicerDropzoneHighlight();
      var ovenSeated = false;
      if (dragCtx.fusedMachineId) {
        ovenSeated = finishFusedAssemblyOvenOnDrop(dragCtx.fusedMachineId);
      }
      clearOvenMagnetHighlight();
      if (!ovenSeated && dragCtx.fusedMachineId && fusedAssemblies[dragCtx.fusedMachineId]) {
        fusedAssemblies[dragCtx.fusedMachineId].ovenPreviewSlot = null;
      }
      finishFusedRigidDrag(p, dragCtx);

      rebuildLayer();
      updateInspector();
      if (moved || seated || ovenSeated) pushHistory();
      if (dragCtx.fusedMachineId) {
        if (ovenSeated) {
          setStatus('Fused splice · seated in heat oven · press HEAT');
        } else if (isFusedAssemblyOvenDocked(dragCtx.fusedMachineId)) {
          setStatus('Fused splice · in heat oven · press HEAT');
        } else {
          setStatus('Fused splice · lift as one assembly');
        }
      }
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function bindPigtailBodyDragGrip(grip) {
    if (!grip || grip.dataset.ptDragBound === '1') return;
    grip.dataset.ptDragBound = '1';
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var id = grip.getAttribute('data-pt-drag');
      var p = findPigtail(id);
      if (!p) return;
      startPigtailBodyDrag(p, e);
    });
  }

  function bindFusedBridgeDragGrip(grip) {
    if (!grip || grip.dataset.fusedDragBound === '1') return;
    grip.dataset.fusedDragBound = '1';
    grip.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      var machineId = grip.getAttribute('data-fused-drag-bridge');
      var pair = getFusedAssemblyPigtails(machineId);
      var p = pair.left || pair.right;
      if (!p || !isPigtailFused(p)) return;
      startPigtailBodyDrag(p, e);
    });
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-pt-node]').forEach(function (node) {
      node.addEventListener('click', function (e) {
        if (e.target.closest('[data-pt-end]') || e.target.closest('[data-pt-drag]')) return;
        if (e.target.closest('[data-pt-sleeve]')) return;
        e.stopPropagation();
        var nodeId = node.getAttribute('data-pt-node');
        if (node.getAttribute('data-cable-node')) selectCable(nodeId);
        else selectPigtail(nodeId);
      });
    });

    host.querySelectorAll('[data-pt-sleeve]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-sleeve');
        var target = parseFiberTargetId(id);
        if (!target) return;
        var p = target.p;
        var sleeveEnd = target.end;
        if (!pigtailEndHasSleeve(p, sleeveEnd)) return;
        if (isMemberEndFusionPermanent(p, sleeveEnd)) return;
        if (isPigtailOvenDragLocked(p, sleeveEnd)) return;
        if (isCable(p)) selectCable(p.id, { skipRebuild: true });
        else selectPigtail(p.id, { skipRebuild: true });
        btn.classList.add('is-dragging');
        document.body.classList.add('lab-sleeve-dragging');
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var moved = false;
        var ejected = false;

        function finishDrag(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-sleeve-dragging');
        }

        function onMove(ev) {
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          var result = dragSleeveAlongPath(p, world.x, world.y, sleeveEnd);
          if (result.eject) {
            ejected = true;
            finishDrag(ev);
            ejectSleeve(id, world.x, world.y);
            return;
          }
          updateSleeveElement(p, btn, sleeveEnd);
        }

        function onUp(ev) {
          if (ejected) return;
          var world = clientToWorld(ev.clientX, ev.clientY);
          var result = dragSleeveAlongPath(p, world.x, world.y, sleeveEnd);
          finishDrag(ev);
          if (result.eject) {
            ejectSleeve(id, world.x, world.y);
            return;
          }
          rebuildLayer();
          updateInspector();
          if (moved) pushHistory();
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    var layerSvg = host.querySelector('.lab-pigtail-svg');
    rebindDragGripsInRoot(layerSvg || host);

    /* Connector drag / plug — snake from A or gravity 1:1 world tracking */
    host.querySelectorAll('[data-pt-end="A"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        if (isCable(p)) {
          e.preventDefault();
          e.stopPropagation();
          var cableEnd = btn.getAttribute('data-cable-end') || 'start';
          p.activeCableEnd = cableEnd;
          selectCable(id);
          var fusedCtx = beginFusedEndDrag(p, cableEnd, e.clientX, e.clientY);
          var fusedMachineId = fusedCtx.machineId;
          var snakeCable = getRouteMode(p) === 'snake';
          var movedCable = false;
          if (!fusedMachineId) {
            if (snakeCable) beginOrthoSnake(p, 'A');
            else p.snake = { dragEnd: 'A' };
          }
          btn.classList.add('is-dragging');
          document.body.classList.add('lab-pigtail-dragging');
          if (fusedMachineId) setFusedAssemblyDragPassthrough(p, true, cableEnd);
          else setPigtailDragPassthrough(p, true);
          var magnetTarget = null;
          function onCableMove(ev) {
            if (fusedMachineId && isPigtailOvenDragLocked(p, cableEnd)) return;
            movedCable = true;
            var w = clientToWorld(ev.clientX, ev.clientY);
            if (fusedMachineId && fusedCtx.chainSnapshot && fusedCtx.w0) {
              applyFusedChainGroupTranslation(
                fusedCtx.chainSnapshot,
                w.x - fusedCtx.w0.x,
                w.y - fusedCtx.w0.y
              );
              refreshFusedChainAfterPathEdits(fusedCtx.chainSnapshot, fusedMachineId);
            } else {
              if (snakeCable) updateOrthoSnake(p, w.x, w.y);
              else moveTipGravity(p, 'A', w.x, w.y);
              restoreCableEndStripFrontier(p, cableEnd);
              if (cableEndIsSnappedToCleaver(p, cableEnd) && isCableEndCleaved(p, cableEnd)) {
                enforceCleavedJacketWallForEnd(p, cableEnd);
              }
              if (!fusedMachineId && cleaverEligibleForDropzone(p, cableEnd) &&
                  global.FtthLab && typeof FtthLab.findCleaverGrooveNear === 'function') {
                var tip = cableEndTipWorld(p, cableEnd);
                var grooveHit = FtthLab.findCleaverGrooveNear(tip.x, tip.y, CLEAVER_SNAP_PX);
                if (grooveHit && grooveHit.dist <= CLEAVER_SNAP_PX) {
                  setCleaverDropzoneHighlight(grooveHit.cleaverId);
                } else {
                  clearCleaverDropzoneHighlight();
                }
              } else if (!fusedMachineId) {
                clearCleaverDropzoneHighlight();
              }
              updateFiberPath(p);
            }
            magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, cableEnd);
          }
          function onCableUp(ev) {
            window.removeEventListener('pointermove', onCableMove);
            window.removeEventListener('pointerup', onCableUp);
            window.removeEventListener('pointercancel', onCableUp);
            btn.classList.remove('is-dragging');
            document.body.classList.remove('lab-pigtail-dragging');
            if (fusedMachineId) {
              setFusedAssemblyDragPassthrough(p, false, cableEnd);
              if (cableEnd === 'start') p.startSplicerDragDetached = false;
              else p.splicerDragDetached = false;
              finishFusedEndDrag(fusedMachineId, fusedCtx.chainSnapshot);
            } else {
              setPigtailDragPassthrough(p, false);
            }
            if (!fusedMachineId) {
              if (snakeCable) endOrthoSnake(p);
              else p.snake = null;
            }
            var seated = false;
            if (!fusedMachineId) {
              var activeCleaver = document.querySelector('.lab-cleaver.cleaver-dropzone-active');
              if (activeCleaver) {
                var dropCleaverId = activeCleaver.getAttribute('data-cleaver-node');
                seated = finishCleaverDropSeat(p, dropCleaverId, cableEnd);
              }
              clearCleaverDropzoneHighlight();
              if (!seated) clearCleaverGuideLine();
            }
            if (!seated) {
              seated = finishSplicerMagnetOnDropForTarget(p, ev.clientX, ev.clientY, cableEnd, magnetTarget);
            }
            if (!seated) {
              if (cableEnd === 'start') p.startSplicerPreviewSlot = null;
              else p.splicerPreviewSlot = null;
            }
            if (cableEnd === 'start') p.startSplicerDragDetached = false;
            else p.splicerDragDetached = false;
            clearSplicerMagnetHighlight();
            clearSplicerDropzoneHighlight();
            rebuildLayer();
            if (movedCable || seated) pushHistory();
          }
          window.addEventListener('pointermove', onCableMove);
          window.addEventListener('pointerup', onCableUp);
          window.addEventListener('pointercancel', onCableUp);
          return;
        }
        var connectorEnd = 'start';
        var blockedMsg = ovenDragBlockedMessage(p, connectorEnd);
        if (blockedMsg) {
          setStatus(blockedMsg);
          return;
        }
        selectPigtail(id);

        var fusedCtx = beginFusedEndDrag(p, connectorEnd, e.clientX, e.clientY);
        var fusedMachineId = fusedCtx.machineId;

        var home = p.connector.attached
          ? { x: p.connector.attached.wx, y: p.connector.attached.wy }
          : null;
        var wasAttached = !!p.connector.attached;
        var startClientX = e.clientX;
        var startClientY = e.clientY;
        var unplugged = false;
        var breakFreeDrag = false;
        var moved = false;
        var snakeMode = getRouteMode(p) === 'snake';

        if (!fusedMachineId) {
          if (snakeMode) {
            beginOrthoSnake(p, 'A');
          } else {
            p.snake = { dragEnd: 'A' };
          }
        }

        if (wasAttached && isOtdrAttachment(p.connector.attached)) {
          detachConnector(p);
          unplugged = true;
          breakFreeDrag = true;
          btn.classList.remove('is-attached');
          if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
            FtthLab.refreshOtdrPorts();
          }
          var w0 = clientToWorld(e.clientX, e.clientY);
          if (snakeMode) {
            updateOrthoSnake(p, w0.x, w0.y);
          } else {
            moveTipGravity(p, 'A', w0.x, w0.y);
          }
          setStatus('SmartOTDR · connector free · release over a port to plug');
        }

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');
        if (fusedMachineId) setFusedAssemblyDragPassthrough(p, true);
        try { btn.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

        var magnetTarget = null;
        function onMove(ev) {
          if (fusedMachineId && isPigtailOvenDragLocked(p, connectorEnd)) return;
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          if (fusedMachineId && fusedCtx.chainSnapshot && fusedCtx.w0) {
            applyFusedChainGroupTranslation(
              fusedCtx.chainSnapshot,
              world.x - fusedCtx.w0.x,
              world.y - fusedCtx.w0.y
            );
            refreshFusedChainAfterPathEdits(fusedCtx.chainSnapshot, fusedMachineId);
            magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, connectorEnd);
            return;
          }
          if (p.connector.attached && !unplugged && !breakFreeDrag) {
            var pullPx = dist2(ev.clientX, ev.clientY, startClientX, startClientY);
            if (pullPx < UNPLUG_PULL_PX) {
              seatConnectorAtPort(p, home.x, home.y);
              updateFiberPath(p);
              return;
            }
            detachConnector(p);
            unplugged = true;
            if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
              FtthLab.refreshOtdrPorts();
            }
            btn.classList.remove('is-attached');
            if (snakeMode) beginOrthoSnake(p, 'A');
            setStatus(
              snakeMode
                ? (fusedMachineId
                  ? 'Fused splice · snake route from connector'
                  : 'Connector · snake route · release on a port to plug')
                : 'Connector free · release on a port to plug'
            );
          }

          if (snakeMode) {
            updateOrthoSnake(p, world.x, world.y);
          } else {
            moveTipGravity(p, 'A', world.x, world.y);
          }

          var hit = resolvePlugHit(ev.clientX, ev.clientY);
          if (breakFreeDrag) {
            if (hit && (hit.owner === 'ols' || hit.owner === 'opm' || hit.owner === 'vfl' || isOtdrPortHit(hit))) {
              highlightPort(hit.el);
              p.connector.liveRot = 180;
            } else {
              highlightPort(null);
            }
          } else {
            highlightPort(hit && hit.el);
            if (hit && hit.owner === 'ols') {
              var mag = applyOlsMagneticPull(p, hit, ev.clientX, ev.clientY);
              if (mag === 'lock' && !p.connector.attached) {
                endOrthoSnake(p);
                attachConnector(p, hit);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                try { btn.releasePointerCapture(ev.pointerId); } catch (errM) { /* ignore */ }
                btn.classList.remove('is-dragging');
                document.body.classList.remove('lab-pigtail-dragging');
                if (fusedMachineId) setFusedAssemblyDragPassthrough(p, false);
                clearPlugHighlights();
                p.connector.liveRot = null;
                rebuildLayer();
                updateInspector();
                pushHistory();
                refreshBudget();
                setStatus(
                  isOtdrPortHit(hit)
                    ? 'SmartOTDR · magnetic dock · SC seated'
                    : 'OLS-35 · magnetic dock · SC seated vertical'
                );
                return;
              }
            } else if (hit && hit.owner === 'opm') {
              var magOpm = applyOpmMagneticPull(p, hit, ev.clientX, ev.clientY);
              if (magOpm === 'lock' && !p.connector.attached) {
                endOrthoSnake(p);
                attachConnector(p, hit);
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                try { btn.releasePointerCapture(ev.pointerId); } catch (errM) { /* ignore */ }
                btn.classList.remove('is-dragging');
                document.body.classList.remove('lab-pigtail-dragging');
                if (fusedMachineId) setFusedAssemblyDragPassthrough(p, false);
                clearPlugHighlights();
                p.connector.liveRot = null;
                rebuildLayer();
                updateInspector();
                pushHistory();
                refreshBudget();
                setStatus(
                  isOtdrPortHit(hit)
                    ? 'SmartOTDR · magnetic dock · SC seated'
                    : 'OLP-38 · magnetic dock · SC seated'
                );
                return;
              }
            } else if (!snakeMode && hit && hit.owner === 'vfl' &&
                dist2(p.ax, p.ay, hit.wx, hit.wy) < plugSnapRadiusFor(hit)) {
              p.connector.liveRot = 180;
            }
          }
          magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, connectorEnd);
          updateFiberPath(p);
        }

        function onUp(ev) {
          breakFreeDrag = false;
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          try { btn.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-pigtail-dragging');
          if (fusedMachineId) {
            setFusedAssemblyDragPassthrough(p, false, connectorEnd);
            p.splicerDragDetached = false;
            clearOvenMagnetHighlight();
            if (fusedAssemblies[fusedMachineId]) fusedAssemblies[fusedMachineId].ovenPreviewSlot = null;
            finishFusedEndDrag(fusedMachineId, fusedCtx.chainSnapshot);
          }
          clearPlugHighlights();
          if (!fusedMachineId) {
            if (snakeMode) endOrthoSnake(p);
            else p.snake = null;
          }
          if (!p.connector.attached) p.connector.liveRot = null;

          var splicerSeated = finishSplicerMagnetOnDropForTarget(
            p, ev.clientX, ev.clientY, connectorEnd, magnetTarget
          );
          if (!splicerSeated) {
            if (!p.connector.attached) {
              var hit = resolvePlugHit(ev.clientX, ev.clientY);
              var snapR = plugSnapRadiusFor(hit);
              var d = hit
                ? (hit.screenDist != null
                  ? hit.screenDist
                  : dist2(p.ax, p.ay, hit.wx, hit.wy))
                : 9999;
              if (hit && d < snapR) {
                attachConnector(p, hit);
              }
            } else if (wasAttached && !unplugged && home) {
              seatConnectorAtPort(p, home.x, home.y);
              setStatus('Connector locked · pull farther to unplug');
            }
          }
          rebuildLayer();
          updateInspector();
          if (moved || unplugged) pushHistory();
          refreshBudget();
          if (fusedMachineId) {
            setStatus(
              snakeMode
                ? 'Fused splice · snake route · drag connector or weld tip'
                : 'Fused splice · drag connector or weld tip to route'
            );
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });

    /* Bare tip drag — snake from B or gravity 1:1; connector stays pinned in snake */
    host.querySelectorAll('[data-pt-end="B"]').forEach(function (btn) {
      btn.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-pt-id');
        var p = findPigtail(id);
        if (!p) return;
        var cableEnd = isCable(p) ? (btn.getAttribute('data-cable-end') || 'end') : 'end';
        var blockedMsg = ovenDragBlockedMessage(p, cableEnd);
        if (blockedMsg) {
          setStatus(blockedMsg);
          return;
        }
        if (isCable(p)) selectCable(id);
        else selectPigtail(id);
        if (isCable(p)) p.activeCableEnd = cableEnd;

        var fusedCtx = beginFusedEndDrag(p, cableEnd, e.clientX, e.clientY);
        var fusedMachineId = fusedCtx.machineId;

        var undocked = false;
        var moved = false;
        var snakeMode = getRouteMode(p) === 'snake';

        if (!fusedMachineId && !isCable(p)) {
          if (p.isSnappedToCleaver) {
            clearCleaverSnap(p, { skipGuide: true });
          } else if (p.isSnappedToSplicer) {
            forceUnsnapPigtailFromSplicer(p);
          } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
            restorePermanentStripFrontier(p);
          }
        }

        if (!fusedMachineId) {
          if (snakeMode) beginOrthoSnake(p, 'B');
          else p.snake = { dragEnd: 'B' };
        }

        var home = p.tail.attached
          ? { x: p.tail.attached.wx, y: p.tail.attached.wy }
          : null;

        btn.classList.add('is-dragging');
        document.body.classList.add('lab-pigtail-dragging');
        if (fusedMachineId) setFusedAssemblyDragPassthrough(p, true, cableEnd);
        else setPigtailDragPassthrough(p, true);

        var magnetTarget = null;
        function onMove(ev) {
          if (fusedMachineId && isPigtailOvenDragLocked(p, cableEnd)) return;
          moved = true;
          var world = clientToWorld(ev.clientX, ev.clientY);
          if (fusedMachineId && fusedCtx.chainSnapshot && fusedCtx.w0) {
            applyFusedChainGroupTranslation(
              fusedCtx.chainSnapshot,
              world.x - fusedCtx.w0.x,
              world.y - fusedCtx.w0.y
            );
            refreshFusedChainAfterPathEdits(fusedCtx.chainSnapshot, fusedMachineId);
            magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, cableEnd);
            return;
          }
          if (!isCable(p) && p.tail.attached && !undocked) {
            var pull = dist2(world.x, world.y, home.x, home.y);
            if (pull < TAIL_SNAP_PX) {
              p.bx = home.x;
              p.by = home.y;
              updateFiberPath(p);
              return;
            }
            detachTail(p);
            undocked = true;
            btn.classList.remove('is-attached');
            if (snakeMode) beginOrthoSnake(p, 'B');
            setStatus(
              snakeMode
                ? (fusedMachineId
                  ? 'Fused splice · snake route from weld tip'
                  : 'Bare tip · snake route · release on splice / termination')
                : 'Bare tip free · release on splice / termination'
            );
          }

          if (snakeMode) {
            updateOrthoSnake(p, world.x, world.y);
          } else {
            moveTipGravity(p, 'B', world.x, world.y);
          }

          if (isCable(p)) {
            restoreCableEndStripFrontier(p, cableEnd);
            if (cableEndIsSnappedToCleaver(p, cableEnd) && isCableEndCleaved(p, cableEnd)) {
              enforceCleavedJacketWallForEnd(p, cableEnd);
            }
          } else if (isFullyStrippedPigtail(p) || p.stripFrontierLock) {
            restorePermanentStripFrontier(p);
            if (p.isSnappedToCleaver && (p.isCleaved || p.cleaved)) {
              enforceCleavedJacketWall(p);
            }
          }

          if (!fusedMachineId && cleaverEligibleForDropzone(p, cableEnd) &&
              global.FtthLab && typeof FtthLab.findCleaverGrooveNear === 'function') {
            var cableTip = isCable(p) ? cableEndTipWorld(p, cableEnd) : { x: p.bx, y: p.by };
            var grooveHit = FtthLab.findCleaverGrooveNear(cableTip.x, cableTip.y, CLEAVER_SNAP_PX);
            if (grooveHit && grooveHit.dist <= CLEAVER_SNAP_PX) {
              setCleaverDropzoneHighlight(grooveHit.cleaverId);
            } else {
              clearCleaverDropzoneHighlight();
            }
          } else if (!fusedMachineId) {
            clearCleaverDropzoneHighlight();
          }

          var hit = hitTestTailTarget(ev.clientX, ev.clientY);
          highlightPort(hit && hit.el);
          updateFiberPath(p);
          magnetTarget = applySplicerMagnetDuringDragForTarget(p, ev.clientX, ev.clientY, cableEnd);
        }

        function onUp(ev) {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
          window.removeEventListener('pointercancel', onUp);
          btn.classList.remove('is-dragging');
          document.body.classList.remove('lab-pigtail-dragging');
          if (fusedMachineId) {
            setFusedAssemblyDragPassthrough(p, false, cableEnd);
            if (cableEnd === 'start') p.startSplicerDragDetached = false;
            else p.splicerDragDetached = false;
            clearOvenMagnetHighlight();
            if (fusedAssemblies[fusedMachineId]) fusedAssemblies[fusedMachineId].ovenPreviewSlot = null;
            finishFusedEndDrag(fusedMachineId, fusedCtx.chainSnapshot);
          } else {
            setPigtailDragPassthrough(p, false);
          }
          clearPlugHighlights();
          if (!fusedMachineId) {
            if (snakeMode) endOrthoSnake(p);
            else p.snake = null;
          }

          var seated = false;
          if (!fusedMachineId) {
            var activeCleaver = document.querySelector('.lab-cleaver.cleaver-dropzone-active');
            if (activeCleaver) {
              var dropCleaverId = activeCleaver.getAttribute('data-cleaver-node');
              seated = finishCleaverDropSeat(p, dropCleaverId, cableEnd);
            }
            clearCleaverDropzoneHighlight();
            if (!seated) clearCleaverGuideLine();
          }
          if (!seated) {
            seated = finishSplicerMagnetOnDropForTarget(p, ev.clientX, ev.clientY, cableEnd, magnetTarget);
          }
          if (!seated) {
            if (cableEnd === 'start') p.startSplicerPreviewSlot = null;
            else p.splicerPreviewSlot = null;
          }
          if (cableEnd === 'start') p.startSplicerDragDetached = false;
          else p.splicerDragDetached = false;
          clearSplicerMagnetHighlight();
          clearSplicerDropzoneHighlight();

          if (!seated && !fusedMachineId && !isCable(p) &&
              !p.tail.attached && !p.isSnappedToCleaver && !p.isSnappedToSplicer) {
            var hit = hitTestTailTarget(ev.clientX, ev.clientY);
            if (hit) {
              attachTail(p, hit);
            }
          }
          rebuildLayer();
          updateInspector();
          if (moved || undocked || seated) pushHistory();
          if (fusedMachineId) {
            setStatus(
              snakeMode
                ? 'Fused splice · snake route · drag connector or weld tip'
                : 'Fused splice · drag connector or weld tip to route'
            );
          }
        }

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      });
    });
  }

  /* ─── Toolbox ─── */

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-pigtail-tree', 'pigtail')
      : document.getElementById('lab-pigtail-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--pigtail' +
      (selectedTool === 'pigtail' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="pigtail" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--pigtail" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>SC Pigtail</strong>' +
      '<span>SC connector + bare fiber</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="pigtail"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-pigtail');
      }
      selectedTool = 'pigtail';
      renderToolbox();
      setStatus('SC Pigtail · drag onto canvas · plug connector · park bare tip on splice/term');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('sc-pigtail');
      }
      selectedTool = 'pigtail';
      dragLib = { kind: 'pigtail' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'pigtail' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:pigtail');
        e.dataTransfer.setData('text/lab-drag', 'pigtail');
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
      if (!el || el.dataset.pigtailDrop === '1') return;
      el.dataset.pigtailDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'pigtail') || (active && active.kind === 'pigtail'))) {
          return;
        }
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'pigtail') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'pigtail';
        var pt = clientToWorld(e.clientX, e.clientY);
        placePigtail(Math.round(pt.x - 8), Math.round(pt.y - 10));
      });
    });
  }

  /* ─── Inspector / budget ─── */

  function pigtailLossDb(p) {
    if (!p.connector.attached) return 0;
    var loss = MATCHED_CONNECTOR_DB;
    if (p.connector.mismatch) loss += MISMATCH_PENALTY_DB;
    return loss;
  }

  function getNetworkLossDb() {
    var sum = 0;
    pigtails.forEach(function (p) { sum += pigtailLossDb(p); });
    return Math.round(sum * 100) / 100;
  }

  function getMismatchCount() {
    var n = 0;
    pigtails.forEach(function (p) {
      if (p.connector.attached && p.connector.mismatch) n += 1;
    });
    return n;
  }

  function refreshBudget() {
    if (global.FtthLab && typeof FtthLab.refreshPowerBudget === 'function') {
      FtthLab.refreshPowerBudget();
    }
  }

  function pigtailLengthUnit(p) {
    return p && p.lengthUnit === 'km' ? 'km' : 'm';
  }

  function pigtailLengthDisplayValue(p) {
    if (p && typeof p.cableLength === 'number' && isFinite(p.cableLength)) {
      return p.cableLength;
    }
    var meters = pigtailFiberLengthM(p);
    return pigtailLengthUnit(p) === 'km' ? meters / 1000 : meters;
  }

  function pigtailLengthInputToMeters(value, unit) {
    var n = Number(value);
    if (!isFinite(n) || n < 0) n = 0;
    return unit === 'km' ? n * 1000 : n;
  }

  function applyPigtailCableLength(p) {
    if (!p || typeof p.lengthMeters !== 'number') return;
    var ppm = 160;
    if (global.FtthLab && typeof FtthLab.metersToWorldPx === 'function') {
      p.fixedLength = FtthLab.metersToWorldPx(p.lengthMeters);
    } else {
      p.fixedLength = p.lengthMeters * ppm;
    }
    rebuildLayer();
    updateFiberPath(p);
  }

  function normalizeOtdrCableLengthMeters(m) {
    var n = Number(m);
    if (!isFinite(n) || n < 0) n = 0;
    if (n > 50000) n = 50000;
    return Math.round(n * 1000) / 1000;
  }

  function applyPigtailCableLengthModel(p, value, unit) {
    if (!p) return 0;
    unit = unit === 'km' ? 'km' : 'm';
    var displayVal = parseFloat(value);
    if (!isFinite(displayVal) || displayVal < 0) displayVal = 0;
    p.cableLength = displayVal;
    p.lengthUnit = unit;
    p.lengthMeters = normalizeOtdrCableLengthMeters(pigtailLengthInputToMeters(displayVal, unit));
    return p.lengthMeters;
  }

  function setPigtailCableLength(id, value, unit) {
    var p = findPigtail(id);
    if (!p) return;
    applyPigtailCableLengthModel(p, value, unit);
    applyPigtailCableLength(p);
    updateInspector();
    pushHistory();
    setStatus('Pigtail cable length · ' + pigtailLengthDisplayValue(p).toFixed(2) + ' ' + p.lengthUnit);
  }

  function setPigtailLengthUnit(id, unit) {
    var p = findPigtail(id);
    if (!p) return;
    p.lengthUnit = unit === 'km' ? 'km' : 'm';
    updateInspector();
  }

  function pigtailFiberLengthM(p) {
    if (!p) return 0;
    if (typeof p.cableLength === 'number' && isFinite(p.cableLength)) {
      return normalizeOtdrCableLengthMeters(
        pigtailLengthInputToMeters(p.cableLength, p.lengthUnit || 'm')
      );
    }
    if (typeof p.lengthMeters === 'number' && p.lengthMeters > 0) {
      return p.lengthMeters;
    }
    if (typeof p.fixedLength === 'number' && p.fixedLength > 0) {
      var ppm = 160;
      if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
        return FtthLab.worldPxToMeters(p.fixedLength);
      }
      return p.fixedLength / ppm;
    }
    var dx = p.bx - p.ax;
    var dy = p.by - p.ay;
    var lenPx = Math.sqrt(dx * dx + dy * dy);
    if (global.FtthLab && typeof FtthLab.worldPxToMeters === 'function') {
      return FtthLab.worldPxToMeters(lenPx);
    }
    return lenPx / 160;
  }

  function getFusedAssemblyOpticalPairs() {
    var map = {};
    function addPair(leftId, rightId, assemblyId, machineId, permanent, spliceLossDb, leftKey, rightKey) {
      if (!leftId || !rightId || leftId === rightId) return;
      var key = assemblyId || makeFusionAssemblyId(leftId, rightId);
      if (!key) return;
      var existing = map[key];
      map[key] = {
        assemblyId: key,
        fusionAssemblyId: key,
        machineId: machineId || (existing && existing.machineId) || null,
        leftId: leftId,
        rightId: rightId,
        leftKey: leftKey || (existing && existing.leftKey) || null,
        rightKey: rightKey || (existing && existing.rightKey) || null,
        permanent: !!(permanent || (existing && existing.permanent)),
        spliceLossDb: typeof spliceLossDb === 'number' && isFinite(spliceLossDb)
          ? spliceLossDb
          : (existing && typeof existing.spliceLossDb === 'number' ? existing.spliceLossDb : null),
        loss: typeof spliceLossDb === 'number' && isFinite(spliceLossDb)
          ? spliceLossDb
          : (existing && typeof existing.loss === 'number'
            ? existing.loss
            : (existing && typeof existing.spliceLossDb === 'number' ? existing.spliceLossDb : null)),
      };
    }
    Object.keys(fusedAssemblies).forEach(function (assemblyId) {
      var asm = fusedAssemblies[assemblyId];
      var pair = getFusedAssemblyPigtails(assemblyId);
      addPair(
        pair.left ? pair.left.id : (asm && asm.leftId),
        pair.right ? pair.right.id : (asm && asm.rightId),
        assemblyId,
        asm && asm.machineId,
        asm && isFusionAssemblyPermanent(asm),
        asm && asm.spliceLossDb,
        asm && asm.leftKey,
        asm && asm.rightKey
      );
    });
    pigtails.forEach(function (p) {
      if (!p.fusedPartnerId) return;
      var asm = p.fusionAssemblyId ? fusedAssemblies[p.fusionAssemblyId] : null;
      addPair(
        p.id,
        p.fusedPartnerId,
        p.fusionAssemblyId,
        p.splicerWeldMachineId,
        isPigtailFusionPermanent(p),
        asm && asm.spliceLossDb
      );
    });
    return Object.keys(map).map(function (key) { return map[key]; });
  }

  function getLaserGraphNodes() {
    return pigtails.map(function (p) {
      if (isCable(p)) {
        syncCablePrepState(p);
        var cableFiberM = pigtailFiberLengthM(p);
        return {
          id: p.id,
          type: 'cable',
          startKey: opticalEndpointKey(p, 'start'),
          endKey: opticalEndpointKey(p, 'end'),
          startFusionAssemblyId: getMemberEndFusionAssemblyId(p, 'start') || null,
          endFusionAssemblyId: getMemberEndFusionAssemblyId(p, 'end') || null,
          fusionAssemblyId: getMemberEndFusionAssemblyId(p, 'end') || null,
          startFusedPartnerId: getMemberEndFusedPartnerId(p, 'start') || null,
          endFusedPartnerId: getMemberEndFusedPartnerId(p, 'end') || null,
          fusedPartnerId: getMemberEndFusedPartnerId(p, 'end') || null,
          startSplicerWeldMachineId: getMemberEndSplicerWeldMachineId(p, 'start') || null,
          splicerWeldMachineId: getMemberEndSplicerWeldMachineId(p, 'end') || null,
          cableLength: pigtailLengthDisplayValue(p),
          lengthUnit: pigtailLengthUnit(p),
          lengthMeters: cableFiberM,
          fiberLengthM: cableFiberM,
          ax: p.ax,
          ay: p.ay,
          bx: p.bx,
          by: p.by,
          fixedLength: typeof p.fixedLength === 'number' ? p.fixedLength : null,
          route: p.route && p.route.length ? p.route.slice() : null,
          freeStart: !isMemberEndFused(p, 'start'),
          freeEnd: !isMemberEndFused(p, 'end'),
        };
      }
      var partner = getFusedPartner(p);
      var fused = isPigtailFused(p);
      var asmId = getPigtailFusionAssemblyId(p);
      var shrunk = !!(fused && partner && asmId && isFusedAssemblySleeveShrunk(asmId));
      return {
        id: p.id,
        type: 'pigtail',
        sleeveShrunk: shrunk,
        isSleeveShrunk: shrunk,
        fusionPermanent: isPigtailFusionPermanent(p),
        fusedPartnerId: (fused && partner) ? partner.id : null,
        fusionAssemblyId: asmId || null,
        splicerWeldMachineId: p.splicerWeldMachineId || null,
        connector: p.connector.attached
          ? {
              owner: p.connector.attached.owner,
              couplerId: p.connector.attached.couplerId || null,
              vflId: p.connector.attached.vflId || null,
              opmId: p.connector.attached.opmId || null,
              olsId: p.connector.attached.olsId || null,
              splitterId: p.connector.attached.splitterId || null,
              port: p.connector.attached.port || null,
              slot: p.connector.attached.slot != null ? p.connector.attached.slot : null,
              oltPort: p.connector.attached.oltPort != null ? p.connector.attached.oltPort : null,
              mismatch: !!p.connector.mismatch,
              polish: p.polish === 'APC' ? 'APC' : 'UPC',
            }
          : null,
        tail: p.tail.attached
          ? {
              owner: p.tail.attached.owner,
              spliceId: p.tail.attached.spliceId || null,
              termId: p.tail.attached.termId || null,
            }
          : null,
        cableLength: pigtailLengthDisplayValue(p),
        lengthUnit: pigtailLengthUnit(p),
        lengthMeters: pigtailFiberLengthM(p),
        fiberLengthM: pigtailFiberLengthM(p),
        ax: p.ax,
        ay: p.ay,
        bx: p.bx,
        by: p.by,
        fixedLength: typeof p.fixedLength === 'number' ? p.fixedLength : null,
        route: p.route && p.route.length ? p.route.slice() : null,
      };
    });
  }

  function collectFusedGlowMapFromPigtailIds(map) {
    var fusedGlow = {};
    Object.keys(map).forEach(function (id) {
      if (!map[id]) return;
      var pg = findPigtail(id);
      if (!pg || !isPigtailFused(pg)) return;
      if (isCable(pg)) {
        ['start', 'end'].forEach(function (end) {
          if (!isMemberEndFused(pg, end)) return;
          var asmId = getMemberEndFusionAssemblyId(pg, end);
          if (asmId) fusedGlow[asmId] = true;
          var partnerId = getMemberEndFusedPartnerId(pg, end);
          if (partnerId) map[partnerId] = true;
        });
        return;
      }
      fusedGlow[getPigtailFusionAssemblyId(pg) || pg.fusionAssemblyId] = true;
      var partner = getFusedPartner(pg);
      if (partner) map[partner.id] = true;
    });
    Object.keys(fusedAssemblies).forEach(function (mid) {
      if (!isFusedAssembly(mid)) return;
      var pair = getFusedAssemblyPigtails(mid);
      if ((pair.left && map[pair.left.id]) || (pair.right && map[pair.right.id])) {
        fusedGlow[mid] = true;
        if (pair.left) map[pair.left.id] = true;
        if (pair.right) map[pair.right.id] = true;
      }
    });
    return fusedGlow;
  }

  function collectLaserGlowSvgRoots() {
    var roots = [];
    if (layer) {
      var mainSvg = layer.querySelector('.lab-pigtail-svg');
      if (mainSvg) roots.push(mainSvg);
    }
    if (typeof document !== 'undefined') {
      document.querySelectorAll('[data-fusion-fiber-layer] .lab-pigtail-svg').forEach(function (svg) {
        if (roots.indexOf(svg) < 0) roots.push(svg);
      });
    }
    return roots;
  }

  function applyLaserGlow(ids, mode, meta) {
    meta = meta || {};
    var map = {};
    var exits = meta.pigtailExits || {};
    (ids || []).forEach(function (id) { map[id] = true; });
    var fusedGlow = collectFusedGlowMapFromPigtailIds(map);
    if (!mode && global.FtthLab && FtthLab._vflGlow) mode = FtthLab._vflGlow.mode;
    mode = String(mode || 'OFF').toUpperCase();
    if (!layer) return;

    function setGlow(el, on) {
      if (!el) return;
      el.classList.remove('is-vfl-glow', 'is-vfl-glow--cw', 'is-vfl-glow--glint');
      if (!on || mode === 'OFF') return;
      el.classList.add('is-vfl-glow');
      el.classList.add(mode === 'GLINT' ? 'is-vfl-glow--glint' : 'is-vfl-glow--cw');
    }

    collectLaserGlowSvgRoots().forEach(function (svgRoot) {
      /* Jacket / bare glass paths never pick up laser tint — same as patch cord */
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
          var pg = findPigtail(baseId);
          on = !!(map[id] || map[baseId]);
          if (on && pg && isPigtailFused(pg) && !isCable(pg)) on = false;
        }
        setGlow(el, on);
      });
    });

    layer.querySelectorAll('[data-pt-id][data-pt-end]').forEach(function (el) {
      var id = el.getAttribute('data-pt-id');
      var end = el.getAttribute('data-pt-end');
      el.classList.remove('is-vfl-laser-exit', 'is-vfl-laser-exit--cw', 'is-vfl-laser-exit--glint');
      if (map[id] && exits[id] === end && mode !== 'OFF' && !el.classList.contains('is-attached')) {
        el.classList.add('is-vfl-laser-exit');
        el.classList.add(mode === 'GLINT' ? 'is-vfl-laser-exit--glint' : 'is-vfl-laser-exit--cw');
      }
    });
  }

  function reapplyStoredVflGlow() {
    var glow = global.FtthLab && FtthLab._vflGlow;
    if (glow) applyLaserGlow(glow.pigtails, glow.mode, { pigtailExits: glow.pigtailExits });
  }

  function wireInspectorCommonHandlers(detail, p) {
    if (!detail || !p) return;
    detail.querySelectorAll('[data-pt-otdr-len-unit]').forEach(function (sel) {
      sel.addEventListener('change', function () {
        setPigtailLengthUnit(p.id, sel.value);
        var lenInput = detail.querySelector('[data-pt-otdr-len="' + p.id + '"]');
        if (lenInput) setPigtailCableLength(p.id, lenInput.value, sel.value);
      });
    });
    var ptLenInput = detail.querySelector('[data-pt-otdr-len]');
    if (ptLenInput) {
      ptLenInput.addEventListener('input', function () {
        var unitSel = detail.querySelector('[data-pt-otdr-len-unit="' + p.id + '"]');
        applyPigtailCableLengthModel(p, ptLenInput.value, unitSel ? unitSel.value : pigtailLengthUnit(p));
      });
      ptLenInput.addEventListener('change', function () {
        var unitSel = detail.querySelector('[data-pt-otdr-len-unit="' + p.id + '"]');
        setPigtailCableLength(p.id, ptLenInput.value, unitSel ? unitSel.value : pigtailLengthUnit(p));
      });
      ptLenInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          var unitSel = detail.querySelector('[data-pt-otdr-len-unit="' + p.id + '"]');
          setPigtailCableLength(p.id, ptLenInput.value, unitSel ? unitSel.value : pigtailLengthUnit(p));
        }
      });
    }
    detail.querySelectorAll('[data-pt-route-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pt-route-mode').split(':');
        setRouteMode(parts[0], parts[1]);
      });
    });
    var rm = detail.querySelector('[data-remove-pt]');
    if (rm) {
      rm.addEventListener('click', function () {
        removePigtail(p.id);
        if (global.FtthLab && typeof FtthLab.resetInspectorIdle === 'function') {
          FtthLab.resetInspectorIdle();
        }
      });
    }
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card) return;
    if ((selection.kind !== 'pigtail' && selection.kind !== 'cable') || !selection.id) return;
    var p = findPigtail(selection.id);
    if (!p) return;

    if (isCable(p)) {
      syncCablePrepState(p);
      card.innerHTML =
        '<h2>Cable</h2>' +
        '<p>Bare fiber cable on both ends for splicing.</p>';
      if (!detail) return;
      detail.hidden = false;
      detail.innerHTML =
        '<div class="lab-pigtail-config">' +
        '<p class="lab-inspector__label">Cable route mode</p>' +
        '<div class="lab-route-mode-toggle" role="group" aria-label="Cable route mode">' +
        '<button type="button" class="lab-route-mode-btn' +
        (getRouteMode(p) === 'snake' ? ' is-active' : '') +
        '" data-pt-route-mode="' + p.id + ':snake">Snake Route Mode</button>' +
        '<button type="button" class="lab-route-mode-btn' +
        (getRouteMode(p) === 'gravity' ? ' is-active' : '') +
        '" data-pt-route-mode="' + p.id + ':gravity">Gravity Physics Mode</button>' +
        '</div>' +
        buildJacketColorPaletteHtml(p) +
        '<div class="property-group lab-pigtail-otdr-len-group">' +
        '<label class="lab-inspector__label" for="pigtailCordLengthInput-' + p.id + '">Cable Length</label>' +
        '<div class="lab-cable-len-row">' +
        '<input type="number" id="pigtailCordLengthInput-' + p.id +
        '" class="lab-pcord-otdr-len-input" data-pt-otdr-len="' + p.id +
        '" value="' + pigtailLengthDisplayValue(p).toFixed(1) + '" min="0" step="0.1">' +
        '<select id="pigtailCordUnitSelect-' + p.id +
        '" class="lab-cable-len-unit" data-pt-otdr-len-unit="' + p.id +
        '" aria-label="Cable length unit">' +
        '<option value="m"' + (pigtailLengthUnit(p) === 'm' ? ' selected' : '') + '>m</option>' +
        '<option value="km"' + (pigtailLengthUnit(p) === 'km' ? ' selected' : '') + '>km</option>' +
        '</select></div></div>' +
        '<div class="lab-spl-sheet">' +
        '<div><span>Ends</span><strong>Bare · Bare</strong></div>' +
        '<div><span>Start strip</span><strong>' + stripStageLabel(getCableEndStripStage(p, 'start')) + '</strong></div>' +
        '<div><span>End strip</span><strong>' + stripStageLabel(getCableEndStripStage(p, 'end')) + '</strong></div>' +
        '<div><span>Length</span><strong>' + pigtailFiberLengthM(p).toFixed(2) + ' m</strong></div>' +
        '</div>' +
        '<button type="button" class="lab-eject-btn" data-remove-pt="' + p.id + '">Remove Cable</button>' +
        '</div>';
      wireInspectorCommonHandlers(detail, p);
      detail.querySelectorAll('[data-jacket-color]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          setJacketColor(p.id, btn.getAttribute('data-jacket-color'));
        });
      });
      return;
    }

    var isApc = normalizePolish(p.polish) === 'APC';
    var loss = pigtailLossDb(p);
    card.innerHTML =
      '<h2>SC Pigtail</h2>' +
      '<p>One SC connector + bare fiber for splice or termination.</p>';

    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-pigtail-config">' +
      '<p class="lab-inspector__label">Cable route mode</p>' +
      '<div class="lab-route-mode-toggle" role="group" aria-label="Pigtail route mode">' +
      '<button type="button" class="lab-route-mode-btn' +
      (getRouteMode(p) === 'snake' ? ' is-active' : '') +
      '" data-pt-route-mode="' + p.id + ':snake">Snake Route Mode</button>' +
      '<button type="button" class="lab-route-mode-btn' +
      (getRouteMode(p) === 'gravity' ? ' is-active' : '') +
      '" data-pt-route-mode="' + p.id + ':gravity">Gravity Physics Mode</button>' +
      '</div>' +
      '<p class="lab-inspector__label">Connector polish</p>' +
      '<div class="lab-polish-toggle" role="group">' +
      '<button type="button" class="lab-polish-btn is-upc' + (!isApc ? ' is-active' : '') +
      '" data-pt-polish="' + p.id + ':PC">SC/PC · Blue</button>' +
      '<button type="button" class="lab-polish-btn is-apc' + (isApc ? ' is-active' : '') +
      '" data-pt-polish="' + p.id + ':APC">SC/APC · Green</button>' +
      '</div>' +
      buildJacketColorPaletteHtml(p) +
      '<p class="lab-pcord-attach' + (p.connector.mismatch ? ' is-warn' : '') + '">' +
      (p.connector.attached
        ? 'A → ' + p.connector.attached.label +
          (p.connector.mismatch ? ' · MISMATCH +' + MISMATCH_PENALTY_DB + ' dB' : '')
        : 'A · unplugged') +
      '</p>' +
      '<div class="property-group lab-pigtail-otdr-len-group">' +
      '<label class="lab-inspector__label" for="pigtailCordLengthInput-' + p.id + '">Cable Length</label>' +
      '<div class="lab-cable-len-row">' +
      '<input type="number" id="pigtailCordLengthInput-' + p.id +
      '" class="lab-pcord-otdr-len-input" data-pt-otdr-len="' + p.id +
      '" value="' + pigtailLengthDisplayValue(p).toFixed(1) + '" min="0" step="0.1">' +
      '<select id="pigtailCordUnitSelect-' + p.id +
      '" class="lab-cable-len-unit" data-pt-otdr-len-unit="' + p.id +
      '" aria-label="Cable length unit">' +
      '<option value="m"' + (pigtailLengthUnit(p) === 'm' ? ' selected' : '') + '>m</option>' +
      '<option value="km"' + (pigtailLengthUnit(p) === 'km' ? ' selected' : '') + '>km</option>' +
      '</select>' +
      '</div>' +
      '</div>' +
      '<p class="lab-pcord-attach">' +
      (p.tail.attached
        ? 'Tail → ' + p.tail.attached.label
        : (p.isSnappedToCleaver
          ? 'Tail · magnetically seated in cleaver V-groove'
          : 'Tail · free · dock on splice / termination')) +
      '</p>' +
      '<div class="lab-spl-sheet">' +
      '<div><span>Type</span><strong class="' +
      (isApc ? 'is-apc-text' : 'is-upc-text') + '">' + displayPolish(p.polish) +
      '</strong></div>' +
      '<div><span>Ends</span><strong>SC · Bare</strong></div>' +
      '<div><span>Strip</span><strong>' + stripStageLabel(p.stripStage || 0) + '</strong></div>' +
      '<div><span>Clean</span><strong>' +
      (isFullyStrippedPigtail(p)
        ? (p.isCleaned ? 'Cleaned ✓' : 'Needs wipe')
        : '—') + '</strong></div>' +
      '<div><span>Cleave</span><strong>' +
      (p.isCleaved || p.cleaved
        ? (p.cleaveAngle || 90) + '° face · ready to splice'
        : 'Not cleaved') + '</strong></div>' +
      '<div><span>IL</span><strong>' +
      (p.connector.attached ? loss.toFixed(2) + ' dB' : '—') +
      '</strong></div>' +
      '</div>' +
      '<button type="button" class="lab-eject-btn" data-remove-pt="' + p.id +
      '">Remove Pigtail</button>' +
      '</div>';

    wireInspectorCommonHandlers(detail, p);
    detail.querySelectorAll('[data-pt-polish]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parts = btn.getAttribute('data-pt-polish').split(':');
        setConnectorPolish(parts[0], parts[1]);
      });
    });
    detail.querySelectorAll('[data-jacket-color]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setJacketColor(p.id, btn.getAttribute('data-jacket-color'));
      });
    });
  }

  function onLayoutChange(payload) {
    if (!layer) return;
    var onlyCoupler = payload && payload.source === 'coupler' ? payload.couplerId : null;
    var onlyVfl = payload && payload.source === 'vfl' ? payload.vflId : null;
    pigtails.forEach(function (p) {
      if (onlyCoupler) {
        var on = p.connector.attached && p.connector.attached.owner === 'coupler' &&
          p.connector.attached.couplerId === onlyCoupler;
        if (!on) return;
      }
      if (onlyVfl) {
        var onV = p.connector.attached && p.connector.attached.owner === 'vfl' &&
          p.connector.attached.vflId === onlyVfl;
        if (!onV) return;
      }
      var oax = p.ax;
      var oay = p.ay;
      syncAttached(p);
      var dax = p.ax - oax;
      var day = p.ay - oay;
      if ((dax || day) && !p.tail.attached) {
        /* Keep bare tip planted when only connector moves with equipment */
      }
      updateFiberPath(p);
    });
  }

  function resyncAllAttachments() {
    if (!layer) return;
    pigtails.forEach(function (p) {
      syncAttached(p);
      updateFiberPath(p);
    });
    refreshBudget();
    if (global.FtthLab && typeof FtthLab.refreshOtdrPorts === 'function') {
      FtthLab.refreshOtdrPorts();
    }
  }

  function refreshCouplerPolish(couplerId, polish) {
    polish = portPolishNorm(polish) === 'APC' ? 'APC' : 'UPC';
    var warned = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'coupler') return;
      if (p.connector.attached.couplerId !== couplerId) return;
      p.connector.attached.polish = polish;
      p.connector.attached.label =
        'SC Coupler ' + p.connector.attached.port + ' · ' +
        (polish === 'APC' ? 'SC/APC' : 'SC/PC');
      p.connector.mismatch = !polishMatch(p.polish, polish);
      p.connector.attached.mismatch = p.connector.mismatch;
      if (p.connector.mismatch) warned = true;
    });
    if (warned) showWarning(MISMATCH_MSG);
    rebuildLayer();
    updateInspector();
    refreshBudget();
  }

  function detachPortsForCoupler(couplerId) {
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'coupler') return;
      if (p.connector.attached.couplerId !== couplerId) return;
      detachConnector(p);
      changed = true;
    });
    if (changed) {
      rebuildLayer();
      updateInspector();
      refreshBudget();
    }
  }

  function swapCableEndFields(p, startKey, endKey) {
    var tmp = p[startKey];
    p[startKey] = p[endKey];
    p[endKey] = tmp;
  }

  function flipSelectedCable(p) {
    if (
      p.startIsSnappedToCleaver || p.isSnappedToCleaver ||
      p.startIsSnappedToSplicer || p.isSnappedToSplicer
    ) {
      setStatus('Unsnap cable before flipping');
      return false;
    }
    var tmpX = p.ax;
    var tmpY = p.ay;
    p.ax = p.bx;
    p.ay = p.by;
    p.bx = tmpX;
    p.by = tmpY;
    ensurePathHistory(p);
    if (p.pathHistory && p.pathHistory.length > 1) {
      p.pathHistory = p.pathHistory.slice().reverse();
      p.route = p.pathHistory.slice();
    }
    var tmpPrep = p.startPrepState;
    p.startPrepState = p.endPrepState;
    p.endPrepState = tmpPrep;
    swapCableEndFields(p, 'startFiberStrip', 'fiberStrip');
    swapCableEndFields(p, 'startHasSleeve', 'hasSleeve');
    swapCableEndFields(p, 'startSleeveAlong', 'sleeveAlong');
    swapCableEndFields(p, 'startStripStage', 'stripStage');
    swapCableEndFields(p, 'startStripPeel', 'stripPeel');
    swapCableEndFields(p, 'startIsSnappedToCleaver', 'isSnappedToCleaver');
    swapCableEndFields(p, 'startSnappedCleaverId', 'snappedCleaverId');
    swapCableEndFields(p, 'startCleaverSlotAnchorX', 'cleaverSlotAnchorX');
    swapCableEndFields(p, 'startIsSnappedToSplicer', 'isSnappedToSplicer');
    swapCableEndFields(p, 'startSnappedSplicerId', 'snappedSplicerId');
    swapCableEndFields(p, 'startSnappedSplicerSide', 'snappedSplicerSide');
    swapCableEndFields(p, 'startSplicerGrooveY', 'splicerGrooveY');
    swapCableEndFields(p, 'startSplicerTipX', 'splicerTipX');
    swapCableEndFields(p, 'startSplicerPreviewSlot', 'splicerPreviewSlot');
    swapCableEndFields(p, 'startSplicerDragDetached', 'splicerDragDetached');
    swapCableEndFields(p, 'startSplicerGrooveAnchor', 'splicerGrooveAnchor');
    swapCableEndFields(p, 'startSplicerBareGlassPx', 'splicerBareGlassPx');
    swapCableEndFields(p, 'startSplicerInnerEdgeX', 'splicerInnerEdgeX');
    swapCableEndFields(p, 'startSplicerDockSnapshot', 'splicerDockSnapshot');
    swapCableEndFields(p, 'startSplicerWeldMachineId', 'splicerWeldMachineId');
    swapCableEndFields(p, 'startFusionAssemblyId', 'fusionAssemblyId');
    swapCableEndFields(p, 'startFusedPartnerId', 'fusedPartnerId');
    swapCableEndFields(p, 'startFusionPermanent', 'fusionPermanent');
    swapCableEndFields(p, 'startIsSleeveShrunk', 'isSleeveShrunk');
    swapCableEndFields(p, 'startSplicerFusedSide', 'splicerFusedSide');
    swapCableEndFields(p, 'startFusedJacketEndDist', 'fusedJacketEndDist');
    swapCableEndFields(p, 'startCleavedStripLock', 'cleavedStripLock');
    swapCableEndFields(p, 'startStripFrontierLock', 'stripFrontierLock');
    applyCableLegacyFromPrepStates(p);
    p.activeCableEnd = p.activeCableEnd === 'start' ? 'end' : 'start';
    p.drawLockRot = endRotationDeg(p.ax, p.ay, p.bx, p.by);
    if (p.connector) p.connector.liveRot = p.drawLockRot;
    syncCablePrepState(p);
    rebuildLayer();
    updateInspector();
    pushHistory();
    refreshBudget();
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    setStatus('Cable flipped');
    return true;
  }

  function flipSelectedPigtail() {
    if (selection.kind === 'cable' && selection.id) {
      var cable = findPigtail(selection.id);
      if (!cable || !isCable(cable)) return false;
      return flipSelectedCable(cable);
    }
    if (selection.kind !== 'pigtail' || !selection.id) return false;
    var p = findPigtail(selection.id);
    if (!p) return false;
    if (p.isSnappedToCleaver || p.isSnappedToSplicer) {
      setStatus('Unsnap pigtail before flipping');
      return false;
    }

    function mirrorAroundX(pg, pivotX) {
      function mx(x) { return 2 * pivotX - x; }
      pg.bx = mx(pg.bx);
      ensurePathHistory(pg);
      pg.pathHistory = pg.pathHistory.map(function (pt) {
        return { x: mx(pt.x), y: pt.y };
      });
      pg.route = pg.pathHistory.slice();
      var rot = endRotationDeg(pg.ax, pg.ay, pg.bx, pg.by);
      pg.drawLockRot = rot;
      pg.connector.liveRot = rot;
    }

    if (isPigtailFused(p)) {
      var asmId = getPigtailFusionAssemblyId(p);
      var pair = getFusedAssemblyPigtails(asmId);
      var weld = getFusedWeldWorld(asmId);
      if (!pair.left || !pair.right || !weld) return false;
      mirrorAroundX(pair.left, weld.x);
      mirrorAroundX(pair.right, weld.x);
      syncPigtailFiberLength(pair.left);
      syncPigtailFiberLength(pair.right);
    } else {
      mirrorAroundX(p, p.ax);
    }

    rebuildLayer();
    pushHistory();
    refreshBudget();
    if (global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
    setStatus('Pigtail flipped');
    return true;
  }

  function deleteSelected() {
    if ((selection.kind === 'pigtail' || selection.kind === 'cable') && selection.id) {
      removePigtail(selection.id);
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

  function cancelPatch() { /* pigtails have no dual-state link session */ }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'sc-pigtail') return;
    if (selectedTool === 'pigtail') {
      selectedTool = null;
      renderToolbox();
    }
  }

  function onViewChange() {
    rebuildLayer();
  }

  function detachPigtailsFromVfl(vflId, exceptId) {
    pigtails.forEach(function (p) {
      if (p.id === exceptId) return;
      if (p.connector.attached && p.connector.attached.owner === 'vfl' &&
          p.connector.attached.vflId === vflId) {
        detachConnector(p);
      }
    });
    rebuildLayer();
    refreshBudget();
  }

  /** Rigid group translate for pigtails plugged into a VFL port. */
  function translateForVfl(vflId, dx, dy, opts) {
    opts = opts || {};
    if (!dx && !dy) return;
    var changed = false;
    pigtails.forEach(function (p) {
      if (!p.connector.attached || p.connector.attached.owner !== 'vfl' ||
          p.connector.attached.vflId !== vflId) return;
      changed = true;
      p.ax += dx;
      p.ay += dy;
      p.bx += dx;
      p.by += dy;
      ensurePathHistory(p);
      if (p.pathHistory && p.pathHistory.length) {
        p.pathHistory.forEach(function (pt) {
          pt.x += dx;
          pt.y += dy;
        });
        syncPathAlias(p);
      }
      syncAttached(p);
      if (opts.live) updateFiberPath(p);
    });
    if (changed && !opts.live) rebuildLayer();
    if (changed && global.FtthLab && typeof FtthLab.refreshVflLaser === 'function') {
      FtthLab.refreshVflLaser();
    }
  }

  function mount(api) {
    ctx = api || {};
    pigtails = [];
    fusedAssemblies = {};
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
    refreshBudget();

    if (global.FtthLab) {
      var prevRefresh = FtthLab.refreshCouplerPolish;
      FtthLab.refreshCouplerPolish = function (couplerId, polish) {
        refreshCouplerPolish(couplerId, polish);
        if (typeof prevRefresh === 'function' && prevRefresh !== refreshCouplerPolish) {
          prevRefresh(couplerId, polish);
        }
      };
      var prevDetach = FtthLab.detachPortsForCoupler;
      FtthLab.detachPortsForCoupler = function (couplerId) {
        detachPortsForCoupler(couplerId);
        if (typeof prevDetach === 'function' && prevDetach !== detachPortsForCoupler) {
          prevDetach(couplerId);
        }
      };

      FtthLab.detachPigtailsFromVfl = detachPigtailsFromVfl;
      FtthLab.applySleeveToPigtail = mountSleeve;
      FtthLab.mountSleeveOnPigtail = mountSleeve;
      FtthLab.ejectSleeveFromPigtail = ejectSleeve;
      FtthLab.findBareTipProximity = findBareTipProximity;
      FtthLab.findCleanableStrippedFiberAtClient = findCleanableStrippedFiberAtClient;
      FtthLab.markPigtailCleaned = markPigtailCleaned;
      FtthLab.hitTestPigtailAtClient = hitTestPigtailAtClient;
      FtthLab.hitTestPigtailBareEnd = hitTestPigtailBareEnd;
      FtthLab.findPigtailStripTarget = findStripTarget;
      FtthLab.findPigtailStripTargetAtWorld = findStripTargetAtWorld;
      FtthLab.recordStripToolAtWorld = recordStripToolAtWorld;
      FtthLab.setPigtailStripPeel = setStripPeel;
      FtthLab.setPigtailStripLengthPx = setStripLengthPx;
      FtthLab.clearPigtailStripPeel = clearStripPeel;
      FtthLab.commitPigtailStripStage = commitStripStage;
      FtthLab.projectPigtailStripNotch = projectPigtailStripNotch;
      FtthLab.applyPigtailStripDrag = applyStripDragFromNotch;
      FtthLab.commitPigtailStripPeelSession = commitStripPeelSession;
      FtthLab.setPigtailStripGuide = setStripGuideLine;
      FtthLab.clearPigtailStripGuide = clearStripGuideLine;
      FtthLab.findPigtailCleavTargetAtWorld = findCleavTargetAtWorld;
      FtthLab.findPigtailCleavTargetInGroove = findCleavTargetInGroove;
      FtthLab.getJacketBoundaryWorld = getJacketBoundaryWorld;
      FtthLab.refreshPigtailCleaverSlot = refreshPigtailCleaverSlot;
      FtthLab.findPigtailBladeHit = findPigtailBladeHit;
      FtthLab.commitPigtailCleave = commitCleave;
      FtthLab.commitPigtailCleaveAtBlade = commitCleaveAtBlade;
      FtthLab.getBareGlassLengthAfterCutPx = getBareGlassLengthAfterCutPx;
      FtthLab.getSplicerExposedBareLengthPx = getSplicerExposedBareLengthPx;
      FtthLab.getPigtailFiberRenderStrokeWidths = getPigtailFiberRenderStrokeWidths;
      FtthLab.getJacketColorHex = getJacketColorHex;
      FtthLab.DEFAULT_CLEAVED_GLASS_LENGTH_PX = DEFAULT_CLEAVED_GLASS_LENGTH_PX;
      FtthLab.bladeHitRadiusPx = function () { return BLADE_HIT_RADIUS_PX; };
      FtthLab.findPigtailBareTipNearWorld = findBareTipNearWorld;
      FtthLab.snapPigtailToCleaverGroove = function (id, cleaverId, snapX, grooveY, opts) {
        var pig = findPigtail(id);
        if (!pig) return false;
        var ok = snapPigtailToCleaverGroove(pig, cleaverId, snapX, grooveY, opts);
        if (ok) updateFiberPath(pig);
        return ok;
      };
      FtthLab.dockPigtailToCleaver = FtthLab.snapPigtailToCleaverGroove;
      FtthLab.clearPigtailCleaverSnap = function (id) {
        var pig = findPigtail(id);
        if (pig) clearCleaverSnap(pig);
      };
      FtthLab.clearPigtailCleaverDock = FtthLab.clearPigtailCleaverSnap;
      FtthLab.undockPigtailsFromCleaver = undockPigtailsFromCleaver;
      FtthLab.setCleaverGuideLine = setCleaverGuideLine;
      FtthLab.clearCleaverGuideLine = clearCleaverGuideLine;
      FtthLab.finalizePigtailCleaverDock = finalizePigtailCleaverDock;
      FtthLab.handoverPigtailToSplicerClamp = handoverPigtailToSplicerClamp;
      FtthLab.refreshSplicerDocks = refreshSplicerDocks;
      FtthLab.syncSplicerMotorAlignFrame = syncSplicerMotorAlignFrame;
      FtthLab.prepareSplicerAlignmentTips = prepareSplicerAlignmentTips;
      FtthLab.getSplicerDockedPair = getSplicerDockedPair;
      FtthLab.ensureSplicerDockTracking = ensureSplicerDockTracking;
      FtthLab.renderSplicerFiberOverlays = renderSplicerFiberOverlays;
      FtthLab.fuseSplicerFibers = fuseSplicerFibers;
      FtthLab.clearSplicerFusionVisual = clearSplicerFusionVisual;
      FtthLab.isFusedAssembly = isFusedAssembly;
      FtthLab.isPigtailFused = isPigtailFused;
      FtthLab.getFusedAssemblyOpticalPairs = getFusedAssemblyOpticalPairs;
      FtthLab.canStartOvenHeat = canStartOvenHeat;
      FtthLab.isFusedAssemblyOvenDocked = isFusedAssemblyOvenDocked;
      FtthLab.isFusedAssemblySleeveShrunk = isFusedAssemblySleeveShrunk;
      FtthLab.isFiberFused = function (machineId) {
        if (!machineId) return !!global.isFiberFused;
        return Object.keys(fusedAssemblies).some(function (assemblyId) {
          var asm = fusedAssemblies[assemblyId];
          return !!(asm && asm.machineId === machineId);
        });
      };
      FtthLab.clearPigtailSplicerSnap = function (id) {
        var pig = findPigtail(id);
        if (pig) clearSplicerSnap(pig);
      };
      FtthLab.findSplicerGrooveNear = function (clientX, clientY) {
        return hitTestSplicerGroove(clientX, clientY);
      };
      FtthLab.placeCable = placeCable;
      FtthLab.pigtailFiberLengthM = pigtailFiberLengthM;

      document.addEventListener('fusion-splicer:clampLid', function () {
        renderSplicerFiberOverlays();
        refreshSplicerDocks();
      });
      document.addEventListener('fusion-splicer:clampNudge', function () {
        ensureSplicerDockTracking();
        refreshSplicerDocks();
      });
      document.addEventListener('fusion-splicer:spliceStart', function () {
        ensureSplicerDockTracking();
      });
      document.addEventListener('fusion-splicer:spliceComplete', function (ev) {
        var detail = ev.detail || {};
        var machineId = detail.machineId;
        var lossDb = typeof detail.lossDb === 'number' && isFinite(detail.lossDb)
          ? detail.lossDb
          : (typeof detail.loss === 'number' && isFinite(detail.loss) ? detail.loss : null);
        if (machineId && !isSplicerWeldedPair(machineId)) {
          fuseSplicerFibers(machineId, { lossDb: lossDb, loss: lossDb });
        } else if (machineId) {
          if (lossDb != null) {
            var docked = getSplicerDockedPair(machineId);
            if (docked.left && docked.right) {
              var fusionId = makeFusionAssemblyId(docked.left.id, docked.right.id);
              if (fusionId && fusedAssemblies[fusionId]) {
                fusedAssemblies[fusionId].spliceLossDb = lossDb;
                fusedAssemblies[fusionId].loss = lossDb;
              }
            }
          }
          renderSplicerFiberOverlays(machineId);
          refreshSplicerDocks(machineId);
          rebuildLayer();
          refreshBudget();
        }
      });
      document.addEventListener('fusion-splicer:fuseFibers', function (ev) {
        var detail = ev.detail || {};
        var machineId = detail.machineId;
        if (!machineId) return;
        var lossDb = typeof detail.lossDb === 'number' && isFinite(detail.lossDb)
          ? detail.lossDb
          : (typeof detail.loss === 'number' && isFinite(detail.loss) ? detail.loss : null);
        fuseSplicerFibers(machineId, { lossDb: lossDb, loss: lossDb });
      });
      document.addEventListener('fusion-splicer:reset', function (ev) {
        var machineId = ev.detail && ev.detail.machineId;
        if (machineId) clearSplicerFusionVisual(machineId);
      });
      document.addEventListener('fusion-splicer:heatStart', function (ev) {
        var machineId = ev.detail && ev.detail.machineId;
        if (machineId) onOvenHeatStart(machineId);
      });
      document.addEventListener('fusion-splicer:heatProgress', function (ev) {
        var d = ev.detail || {};
        if (d.machineId) onOvenHeatProgress(d.machineId, d.progress);
      });
      document.addEventListener('fusion-splicer:heatComplete', function (ev) {
        var machineId = ev.detail && ev.detail.machineId;
        if (machineId) onOvenHeatComplete(machineId);
      });
      document.addEventListener('fusion-splicer:ovenLid', function () {
        ensureOvenDockTracking();
      });

      var prevTranslate = FtthLab.translateVflGroup;
      FtthLab.translateVflGroup = function (vflId, dx, dy, opts) {
        if (typeof prevTranslate === 'function' && prevTranslate !== translateForVfl) {
          prevTranslate(vflId, dx, dy, opts);
        }
        translateForVfl(vflId, dx, dy, opts);
      };

      var prevGraph = FtthLab.getFiberLaserGraph;
      FtthLab.getFiberLaserGraph = function () {
        var base = typeof prevGraph === 'function'
          ? (prevGraph() || { pcords: [], pigtails: [] })
          : { pcords: [], pigtails: [] };
        base.pigtails = getLaserGraphNodes();
        return base;
      };

      var prevGlow = FtthLab.applyFiberLaserGlow;
      FtthLab.applyFiberLaserGlow = function (targets) {
        if (typeof prevGlow === 'function') prevGlow(targets);
        applyLaserGlow(
          targets && targets.pigtails,
          targets && targets.mode,
          { pigtailExits: targets && targets.pigtailExits }
        );
      };
    }
  }

  var tool = {
    id: 'sc-pigtail',
    mount: mount,
    onViewChange: onViewChange,
    onLayoutChange: onLayoutChange,
    undo: undo,
    redo: redo,
    deleteSelected: deleteSelected,
    flipSelected: flipSelectedPigtail,
    clearSelection: clearSelection,
    cancelPatch: cancelPatch,
    onToolboxClaim: onToolboxClaim,
    getNetworkLossDb: getNetworkLossDb,
    getMismatchCount: getMismatchCount,
    getLaserGraphNodes: getLaserGraphNodes,
    applyLaserGlow: applyLaserGlow,
    applySleeve: applySleeve,
    mountSleeve: mountSleeve,
    ejectSleeve: ejectSleeve,
    findBareTipProximity: findBareTipProximity,
    findStripTarget: findStripTarget,
    setStripPeel: setStripPeel,
    setStripLengthPx: setStripLengthPx,
    clearStripPeel: clearStripPeel,
    commitStripStage: commitStripStage,
    hitTestPigtailAtClient: hitTestPigtailAtClient,
    hitTestPigtailBareEnd: hitTestPigtailBareEnd,
    translateForVfl: translateForVfl,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('pigtail', 'lab-pigtail-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
      updateInspector();
    },
    exportProjectState: captureSnapshot,
    importProjectState: applySnapshot,
    resyncAllAttachments: resyncAllAttachments,
    resetProjectState: function () {
      applySnapshot({ pigtails: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('sc-pigtail', tool);
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
