/**
 * Fusion Splicer Lab — CFS-3 fiber optic stripper.
 * Interactive jaw clamp, 2-stage peel drag, debris particles, clamp audio/haptic.
 */
(function (global) {
  'use strict';

  var IMG_NATURAL_W = 296;
  var IMG_NATURAL_H = 843;
  var IMG_LEFT_EDGE = 107;
  var IMG_RIGHT_EDGE = 167;
  var IMG_PIVOT_LEFT_X = 276.6;
  var IMG_PIVOT_LEFT_Y = 199.2;
  var IMG_PIVOT_RIGHT_X = 14.3;
  var IMG_PIVOT_RIGHT_Y = 193.1;
  var ASSEMBLED_NATURAL_W =
    (IMG_PIVOT_LEFT_X - IMG_LEFT_EDGE) + (IMG_RIGHT_EDGE - IMG_PIVOT_RIGHT_X);
  /* Tool art size (unrotated bitmap). Canvas is a larger square so 360° rotation never clips. */
  var TOOL_H = 239;
  var TOOL_W = Math.round(ASSEMBLED_NATURAL_W * TOOL_H / IMG_NATURAL_H);
  /* Tall enough for jaw art + vertical laser beam above the teeth. */
  var CANVAS_SIZE = 500;
  /* Screw / jaw pivot sits at the square canvas center — DOM (s.x, s.y) maps here. */
  var PIVOT_X = CANVAS_SIZE / 2;
  var PIVOT_Y = CANVAS_SIZE / 2;
  /* Interactive footprint = visual tool art only (not the oversized clip canvas). */
  var HIT_W = TOOL_W;
  var HIT_H = TOOL_H;
  var HIT_LEFT = Math.round(PIVOT_X - TOOL_W / 2);
  var HIT_TOP = Math.round(
    PIVOT_Y - ((IMG_PIVOT_LEFT_Y + IMG_PIVOT_RIGHT_Y) / 2) * TOOL_H / IMG_NATURAL_H
  );
  /* Tight lab wrapper — hugs tool art; pivot (s.x, s.y) maps inside this box. */
  var WRAPPER_W = HIT_W;
  var WRAPPER_H = HIT_H;
  var WRAPPER_PIVOT_X = PIVOT_X - HIT_LEFT;
  var WRAPPER_PIVOT_Y = PIVOT_Y - HIT_TOP;
  var STRIPPER_W = WRAPPER_W;
  var STRIPPER_H = WRAPPER_H;
  /*
   * CFS-3 jaw geometry (tool-local −Y from screw / pivot):
   * Extreme tip ≈ full tip offset; cutting notches sit mid-blade (deep insertion),
   * matching the real CFS-3 holes — NOT the absolute tip.
   */
  var IMG_PIVOT_Y_AVG = (IMG_PIVOT_LEFT_Y + IMG_PIVOT_RIGHT_Y) / 2;
  function naturalYToPivotOffset(natY) {
    return (IMG_PIVOT_Y_AVG - natY) * TOOL_H / IMG_NATURAL_H;
  }
  /** Distance from screw center up to extreme jaw tip (local −Y). */
  var JAW_TIP_OFFSET_Y = naturalYToPivotOffset(0);
  var JAW_Y_OFFSET = JAW_TIP_OFFSET_Y;
  /*
   * Mid-blade notches — natural Y in stripper-left.png (843px art).
   * Calibrated to the painted stripping holes; scaled at probe time.
   */
  var NOTCH_NAT_Y_JACKET = 92;
  var NOTCH_NAT_Y_BUFFER = 118;
  var NOTCH_NAT_Y_COATING = 142;
  var NOTCH_OFFSET_JACKET = naturalYToPivotOffset(NOTCH_NAT_Y_JACKET);
  var NOTCH_OFFSET_BUFFER = naturalYToPivotOffset(NOTCH_NAT_Y_BUFFER);
  var NOTCH_OFFSET_COATING = naturalYToPivotOffset(NOTCH_NAT_Y_COATING);
  /** Must match `.lab-stripper { transform: scale(...) }` in ftth-lab.css */
  var STRIPPER_VISUAL_SCALE = 0.65;
  /** Fine-tune world probe Y (− = probe moves down / screen +Y toward fiber) */
  var NOTCH_HIT_Y_ADJUST = -24;
  /** Fixed vertical laser length from the active notch (local −Y). */
  var LASER_GUIDE_LEN = 180;
  var JAW_CLOSED_DEG = 0;
  var JAW_OPEN_DEG = 12;
  var DRAG_THRESHOLD_PX = 3;
  /** Notch-centered clamp radius (world px) — must overlap fiber centerline. */
  var CLAMP_PROX_PX = 6;
  var PEEL_FRAGMENT_PX = 20;
  var HISTORY_MAX = 40;

  var layer = null;
  var debrisLayer = null;
  var strippers = [];
  var particles = [];
  var particleRaf = null;
  var seq = 0;
  var selection = { kind: 'none', id: null };
  var dragLib = null;
  var selectedTool = null;
  var history = [];
  var historyIndex = -1;
  var historyLocked = false;
  var audioCtx = null;
  var stripperLeftImg = null;
  var stripperRightImg = null;
  var imagesReady = false;
  var imagesLoading = false;

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

  function findStripper(id) {
    for (var i = 0; i < strippers.length; i++) {
      if (strippers[i].id === id) return strippers[i];
    }
    return null;
  }

  /** Active CFS-3 hole for strip stage: 0 jacket · 1 buffer · 2 coating (unscaled art px). */
  function notchOffsetForStage(stage) {
    var st = stage || 0;
    if (st >= 2) return NOTCH_OFFSET_COATING;
    if (st >= 1) return NOTCH_OFFSET_BUFFER;
    return NOTCH_OFFSET_JACKET;
  }

  /** World-space offset from pivot to notch — includes CSS visual scale. */
  function scaledNotchOffsetPx(stage) {
    return notchOffsetForStage(stage) * STRIPPER_VISUAL_SCALE + NOTCH_HIT_Y_ADJUST;
  }

  /** World position of the cutting-notch center (not tip, not pivot). */
  function notchWorldPos(s, stage) {
    var off = scaledNotchOffsetPx(stage);
    return {
      x: s.x,
      y: s.y - off,
    };
  }

  /** Place stripper so the selected notch sits exactly on the fiber clamp point. */
  function alignStripperNotchToFiber(s, fiberX, fiberY, stage) {
    var off = scaledNotchOffsetPx(stage);
    s.x = fiberX;
    s.y = fiberY + off;
    s.rot = 0;
  }

  function clearStripGuide() {
    var changed = false;
    strippers.forEach(function (s) {
      if (s.laserGuide) {
        s.laserGuide = false;
        s.laserGuideStage = 0;
        changed = true;
        paintStripperNode(s);
      }
    });
    if (global.FtthLab && typeof FtthLab.clearPigtailStripGuide === 'function') {
      FtthLab.clearPigtailStripGuide();
    }
    return changed;
  }

  /**
   * Probe SC pigtail from the cutting-notch world point.
   * Prefer the notch matching the pigtail's current strip stage so strip 2 works.
   */
  function findStripTarget(clientX, clientY, s) {
    var thr = CLAMP_PROX_PX;
    if (s && global.FtthLab && typeof FtthLab.findPigtailStripTargetAtWorld === 'function') {
      var order = [0, 1];
      if (s.laserGuideStage === 1) order = [1, 0];
      var best = null;
      var oi;
      for (oi = 0; oi < order.length; oi++) {
        var st = order[oi];
        var notch = notchWorldPos(s, st);
        var hit = FtthLab.findPigtailStripTargetAtWorld(notch.x, notch.y, thr);
        if (!hit) continue;
        if (hit.stage === st) return hit;
        if (!best) best = hit;
      }
      return best;
    }
    if (global.FtthLab && typeof FtthLab.findPigtailStripTarget === 'function') {
      return FtthLab.findPigtailStripTarget(clientX, clientY, thr);
    }
    return null;
  }

  /**
   * Enable/disable vertical notch laser when the cutting hole is near an SC pigtail.
   */
  function refreshStripGuide(s, clientX, clientY, lockedTarget) {
    if (!s) return;
    var target = lockedTarget || null;
    if (!target) {
      target = findStripTarget(clientX, clientY, s);
    }
    var on = !!target;
    var stage = target && typeof target.stage === 'number' ? target.stage : 0;
    if (s.laserGuide === on && s.laserGuideStage === stage) {
      if (on) paintStripperNode(s);
      return;
    }
    s.laserGuide = on;
    s.laserGuideStage = stage;
    paintStripperNode(s);
    if (!on && global.FtthLab && typeof FtthLab.clearPigtailStripGuide === 'function') {
      FtthLab.clearPigtailStripGuide();
    }
  }

  /** Vertical dotted laser from the cutting-notch gap (local tool coords). */
  function drawJawLaserGuide(ctx, s) {
    if (!s || !s.laserGuide) return;
    var notchY = -notchOffsetForStage(s.laserGuideStage || 0);
    var hot = s.jawState === 'clamped';
    ctx.save();
    ctx.strokeStyle = hot ? '#f87171' : '#4ade80';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 4]);
    ctx.shadowColor = hot ? 'rgba(248, 113, 113, 0.55)' : 'rgba(74, 222, 128, 0.55)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    /* Origin = notch centerline (below extreme tip); direction = straight up (−Y). */
    ctx.moveTo(0, notchY);
    ctx.lineTo(0, notchY - LASER_GUIDE_LEN);
    ctx.stroke();
    ctx.restore();
  }

  function setStripPeel(pigtailId, peel) {
    if (global.FtthLab && typeof FtthLab.setPigtailStripPeel === 'function') {
      FtthLab.setPigtailStripPeel(pigtailId, peel);
    }
  }

  function setStripLengthPx(pigtailId, px) {
    if (global.FtthLab && typeof FtthLab.setPigtailStripLengthPx === 'function') {
      FtthLab.setPigtailStripLengthPx(pigtailId, px);
    }
  }

  function commitStripStage(pigtailId) {
    if (global.FtthLab && typeof FtthLab.commitPigtailStripStage === 'function') {
      return FtthLab.commitPigtailStripStage(pigtailId);
    }
    return false;
  }

  function clearStripPeel(pigtailId) {
    if (global.FtthLab && typeof FtthLab.clearPigtailStripPeel === 'function') {
      FtthLab.clearPigtailStripPeel(pigtailId);
    }
  }

  function applyStripDrag(pigtailId, wx, wy, layerKind, session) {
    if (global.FtthLab && typeof FtthLab.applyPigtailStripDrag === 'function') {
      return FtthLab.applyPigtailStripDrag(pigtailId, wx, wy, layerKind, session);
    }
    return null;
  }

  function commitStripPeel(pigtailId, layerKind, session) {
    if (global.FtthLab && typeof FtthLab.commitPigtailStripPeelSession === 'function') {
      FtthLab.commitPigtailStripPeelSession(pigtailId, layerKind, session);
    }
  }

  function captureSnapshot() {
    return { strippers: JSON.parse(JSON.stringify(strippers)), seq: seq };
  }

  function applySnapshot(snap) {
    if (!snap) return;
    historyLocked = true;
    strippers = snap.strippers || [];
    seq = snap.seq || 0;
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
      FtthLab.recordHistory('cfs-stripper');
    }
  }

  function undo() {
    if (historyIndex <= 0) return false;
    historyIndex -= 1;
    applySnapshot(history[historyIndex]);
    setStatus('Undo · CFS-3 Stripper');
    return true;
  }

  function redo() {
    if (historyIndex >= history.length - 1) return false;
    historyIndex += 1;
    applySnapshot(history[historyIndex]);
    setStatus('Redo · CFS-3 Stripper');
    return true;
  }

  function playClampSnip() {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      var t = audioCtx.currentTime;
      var osc = audioCtx.createOscillator();
      var gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(920, t);
      osc.frequency.exponentialRampToValueAtTime(180, t + 0.045);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.08, t + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (err) { /* ignore */ }
    try {
      if (navigator.vibrate) navigator.vibrate(14);
    } catch (err2) { /* ignore */ }
  }

  function ensureDebrisLayer() {
    if (debrisLayer && debrisLayer.parentNode) return debrisLayer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    debrisLayer = document.createElement('div');
    debrisLayer.className = 'lab-stripper-debris-layer';
    debrisLayer.setAttribute('data-lab-stripper-debris', '1');
    mount.appendChild(debrisLayer);
    return debrisLayer;
  }

  function ensureLayer() {
    if (layer && layer.parentNode) return layer;
    var mount = document.getElementById('lab-2d-mount');
    if (!mount) return null;
    layer = document.createElement('div');
    layer.className = 'lab-stripper-layer';
    layer.setAttribute('data-lab-stripper-layer', '1');
    mount.appendChild(layer);
    ensureDebrisLayer();
    return layer;
  }

  var DEFAULT_JACKET_RGB = '250, 204, 21';

  /** Returns "r, g, b" for rgba(); falls back to default jacket yellow. */
  function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return DEFAULT_JACKET_RGB;
    var h = hex.replace('#', '').trim();
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return DEFAULT_JACKET_RGB;
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (!isFinite(r) || !isFinite(g) || !isFinite(b)) return DEFAULT_JACKET_RGB;
    return r + ', ' + g + ', ' + b;
  }

  function spawnDebris(x, y, stage, peelUx, peelUy, jacketColorHex) {
    var host = ensureDebrisLayer();
    if (!host) return;
    var count = stage === 0 ? 7 : 5;
    var i;
    for (i = 0; i < count; i++) {
      var w = stage === 0 ? 5 + Math.random() * 9 : 2 + Math.random() * 4;
      var h = stage === 0 ? 3 + Math.random() * 5 : 1.5 + Math.random() * 3;
      var spread = (Math.random() - 0.5) * 14;
      particles.push({
        x: x + peelUx * (4 + Math.random() * 8) + (-peelUy) * spread,
        y: y + peelUy * (4 + Math.random() * 8) + peelUx * spread,
        vx: peelUx * (1.2 + Math.random() * 2.4) + (Math.random() - 0.5) * 0.8,
        vy: peelUy * (0.6 + Math.random() * 1.2) + Math.random() * 0.4,
        rot: Math.random() * 360,
        vr: (Math.random() - 0.5) * 18,
        w: w,
        h: h,
        life: 1,
        stage: stage,
        jacketColorHex: jacketColorHex || '#facc15',
        el: null,
      });
    }
    startParticleLoop();
  }

  function spawnPeelFragment(x, y, stage, peelUx, peelUy, peelProgress, jacketColorHex) {
    var host = ensureDebrisLayer();
    if (!host) return;
    var len = stage === 0 ? 14 + peelProgress * 10 : 8 + peelProgress * 6;
    particles.push({
      x: x,
      y: y,
      vx: peelUx * 0.35,
      vy: peelUy * 0.2,
      rot: Math.atan2(peelUy, peelUx) * 180 / Math.PI,
      vr: 0,
      w: len,
      h: stage === 0 ? 4.5 : 2.5,
      life: 1,
      stage: stage,
      isFragment: true,
      jacketColorHex: jacketColorHex || '#facc15',
      el: null,
    });
    startParticleLoop();
  }

  function startParticleLoop() {
    if (particleRaf) return;
    function tick() {
      if (!particles.length) {
        particleRaf = null;
        if (debrisLayer) debrisLayer.innerHTML = '';
        return;
      }
      var host = ensureDebrisLayer();
      if (!host) {
        particles = [];
        particleRaf = null;
        return;
      }
      var alive = [];
      var html = '';
      var i;
      for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.vy += 0.22;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= p.isFragment ? 0.028 : 0.018;
        if (p.life <= 0 || p.y > 22000) continue;
        alive.push(p);
        var alpha = Math.min(1, p.life * 1.4);
        var color;
        var border;
        if (p.stage === 0) {
          var jacketRgb = hexToRgb(p.jacketColorHex);
          color = 'rgba(' + jacketRgb + ', ' + alpha + ')';
          border = 'rgba(' + jacketRgb + ', ' + alpha + ')';
        } else {
          color = 'rgba(96, 165, 250, ' + alpha + ')';
          border = 'rgba(29, 78, 216, ' + alpha + ')';
        }
        html +=
          '<span class="lab-stripper-debris' + (p.isFragment ? ' is-fragment' : '') + '" ' +
          'style="left:' + Math.round(p.x) + 'px;top:' + Math.round(p.y) + 'px;' +
          'width:' + p.w.toFixed(1) + 'px;height:' + p.h.toFixed(1) + 'px;' +
          'transform:rotate(' + p.rot.toFixed(1) + 'deg);' +
          'background:' + color + ';border-color:' + border + ';"></span>';
      }
      particles = alive;
      host.innerHTML = html;
      particleRaf = requestAnimationFrame(tick);
    }
    particleRaf = requestAnimationFrame(tick);
  }

  function preloadStripperImages(done) {
    if (imagesReady) {
      if (done) done();
      return;
    }
    if (imagesLoading) {
      if (done) {
        var wait = setInterval(function () {
          if (imagesReady) {
            clearInterval(wait);
            done();
          }
        }, 16);
      }
      return;
    }
    imagesLoading = true;
    var loaded = 0;
    function onReady() {
      loaded += 1;
      if (loaded < 2) return;
      imagesReady =
        stripperLeftImg && stripperRightImg &&
        stripperLeftImg.complete && stripperRightImg.complete &&
        stripperLeftImg.naturalWidth > 0 && stripperRightImg.naturalWidth > 0;
      imagesLoading = false;
      if (layer) paintAllStrippers();
      if (done) done();
    }
    stripperLeftImg = new Image();
    stripperRightImg = new Image();
    stripperLeftImg.decoding = 'async';
    stripperRightImg.decoding = 'async';
    stripperLeftImg.onload = onReady;
    stripperRightImg.onload = onReady;
    stripperLeftImg.onerror = onReady;
    stripperRightImg.onerror = onReady;
    stripperLeftImg.src = 'images/stripper-left.png';
    stripperRightImg.src = 'images/stripper-right.png';
  }

  function getJawSpreadRad(s) {
    // PNG halves are sliced closed at 0°. Spring-rest idle spreads jaws outward ±JAW_OPEN_DEG.
    var spreadDeg = s.jawState === 'clamped' ? JAW_CLOSED_DEG : JAW_OPEN_DEG;
    return spreadDeg * Math.PI / 180;
  }

  function drawCentralScrew(ctx, pivotX, pivotY, scale) {
    var screwR = 7.2 * scale;
    var grad = ctx.createRadialGradient(
      pivotX - screwR * 0.22, pivotY - screwR * 0.28, 0,
      pivotX, pivotY, screwR
    );
    grad.addColorStop(0, '#f1f5f9');
    grad.addColorStop(0.55, '#9ca3af');
    grad.addColorStop(1, '#6b7280');
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.85;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR * 0.72, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.6)';
    ctx.lineWidth = 0.35;
    ctx.stroke();
    ctx.fillStyle = '#374151';
    ctx.beginPath();
    ctx.arc(pivotX, pivotY, screwR * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotX, pivotY - screwR * 0.36);
    ctx.lineTo(pivotX, pivotY + screwR * 0.36);
    ctx.moveTo(pivotX - screwR * 0.36, pivotY);
    ctx.lineTo(pivotX + screwR * 0.36, pivotY);
    ctx.stroke();
  }

  function renderStripperCanvas(canvas, s) {
    if (!canvas || !canvas.getContext) return;
    var ctx = canvas.getContext('2d');
    var dpr = window.devicePixelRatio || 1;
    var cw = Math.round(CANVAS_SIZE * dpr);
    var ch = Math.round(CANVAS_SIZE * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = CANVAS_SIZE + 'px';
      canvas.style.height = CANVAS_SIZE + 'px';
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    if (!imagesReady || !stripperLeftImg || !stripperRightImg) {
      ctx.fillStyle = 'rgba(15, 20, 28, 0.04)';
      ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
      return;
    }

    var scaleX = TOOL_W / IMG_NATURAL_W;
    var scaleY = TOOL_H / IMG_NATURAL_H;
    var scale = Math.min(scaleX, scaleY);
    var plx = IMG_PIVOT_LEFT_X * scaleX;
    var ply = IMG_PIVOT_LEFT_Y * scaleY;
    var prx = IMG_PIVOT_RIGHT_X * scaleX;
    var pry = IMG_PIVOT_RIGHT_Y * scaleY;
    var screwX = PIVOT_X;
    var screwY = PIVOT_Y;
    var spreadRad = getJawSpreadRad(s);
    /* Strict vertical lock: jaws up, handles down — never follow fiber tangent. */
    var rot = 0;

    ctx.save();
    ctx.translate(screwX, screwY);
    if (rot) ctx.rotate(rot);

    ctx.save();
    ctx.rotate(-spreadRad);
    ctx.translate(-plx, -ply);
    ctx.drawImage(
      stripperLeftImg,
      0, 0, IMG_NATURAL_W, IMG_NATURAL_H,
      0, 0, TOOL_W, TOOL_H
    );
    ctx.restore();

    ctx.save();
    ctx.rotate(spreadRad);
    ctx.translate(-prx, -pry);
    ctx.drawImage(
      stripperRightImg,
      0, 0, IMG_NATURAL_W, IMG_NATURAL_H,
      0, 0, TOOL_W, TOOL_H
    );
    ctx.restore();

    drawCentralScrew(ctx, 0, 0, scale);
    /* Laser after jaws/screw, still in pivot-local space: X=0, −Y up from teeth. */
    drawJawLaserGuide(ctx, s);
    ctx.restore();
  }

  function paintStripperNode(s, node) {
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node || !s) return;
    var canvas = node.querySelector('.lab-stripper__art');
    if (canvas) renderStripperCanvas(canvas, s);
  }

  function paintAllStrippers() {
    if (!layer) return;
    strippers.forEach(function (s) {
      paintStripperNode(s);
    });
  }

  function stripperMarkup(s) {
    var selected = selection.id === s.id ? ' is-selected' : '';
    var clamped = s.jawState === 'clamped' ? ' is-clamped' : '';
    return (
      '<div class="lab-stripper' + selected + clamped + '" data-stripper-node="' + s.id + '" ' +
      'style="left:' + Math.round(s.x - WRAPPER_PIVOT_X) + 'px;top:' +
      Math.round(s.y - WRAPPER_PIVOT_Y) + 'px;width:' + WRAPPER_W + 'px;height:' + WRAPPER_H + 'px" ' +
      'title="CFS-3 Fiber Optic Stripper · clamp + peel">' +
      '<canvas class="lab-stripper__art" aria-hidden="true" ' +
      'style="left:' + (-HIT_LEFT) + 'px;top:' + (-HIT_TOP) + 'px"></canvas>' +
      '<button type="button" class="lab-stripper__hit" aria-label="CFS-3 Fiber Optic Stripper"></button>' +
      '</div>'
    );
  }

  /** True only when the pointer is over the visual tool footprint (not empty canvas padding). */
  function isClientOnStripperHit(node, clientX, clientY) {
    if (!node) return false;
    var hit = node.querySelector('.lab-stripper__hit');
    if (!hit) return false;
    var r = hit.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function rebuildLayer() {
    var host = ensureLayer();
    if (!host) return;
    var html = '';
    strippers.forEach(function (s) { html += stripperMarkup(s); });
    host.innerHTML = html;
    bindLayerEvents(host);
    paintAllStrippers();
  }

  function updateStripperPosition(s, node) {
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node) return;
    node.style.left = Math.round(s.x - WRAPPER_PIVOT_X) + 'px';
    node.style.top = Math.round(s.y - WRAPPER_PIVOT_Y) + 'px';
    node.style.width = WRAPPER_W + 'px';
    node.style.height = WRAPPER_H + 'px';
  }

  function updateStripperNode(s, node, opts) {
    opts = opts || {};
    if (!node) node = layer && layer.querySelector('[data-stripper-node="' + s.id + '"]');
    if (!node) return;
    updateStripperPosition(s, node);
    node.classList.toggle('is-clamped', s.jawState === 'clamped');
    if (!opts.skipArt) paintStripperNode(s, node);
  }

  function placeStripper(x, y) {
    seq += 1;
    var item = {
      id: 'str-' + seq,
      x: typeof x === 'number' ? Math.round(x) : 0,
      y: typeof y === 'number' ? Math.round(y) : 0,
      rot: 0,
      jawState: 'open',
      laserGuide: false,
      laserGuideStage: 0,
    };
    strippers.push(item);
    selection = { kind: 'stripper', id: item.id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cfs-stripper');
    }
    rebuildLayer();
    pushHistory();
    updateInspector();
    setStatus('CFS-3 Stripper placed · drag near fiber tip · hold to clamp · peel outward');
    return item;
  }

  function removeStripper(id) {
    strippers = strippers.filter(function (s) { return s.id !== id; });
    if (selection.id === id) selection = { kind: 'none', id: null };
    rebuildLayer();
    updateInspector();
    pushHistory();
    setStatus('CFS-3 Stripper removed');
  }

  function selectStripper(id, opts) {
    selection = { kind: 'stripper', id: id };
    if (global.FtthLab && typeof FtthLab.setSelectionOwner === 'function') {
      FtthLab.setSelectionOwner('cfs-stripper');
    }
    updateInspector();
    if (!(opts && opts.skipRebuild)) rebuildLayer();
  }

  function clampJaws(s, node) {
    s.jawState = 'clamped';
    if (node) {
      node.classList.add('is-clamped');
      paintStripperNode(s, node);
    }
  }

  function openJaws(s, node) {
    s.jawState = 'open';
    if (node) {
      node.classList.remove('is-clamped');
      paintStripperNode(s, node);
    }
  }

  function bindLayerEvents(host) {
    host.querySelectorAll('[data-stripper-node]').forEach(function (node) {
      var hit = node.querySelector('.lab-stripper__hit') || node;

      hit.addEventListener('click', function (e) {
        if (!isClientOnStripperHit(node, e.clientX, e.clientY)) return;
        e.stopPropagation();
        selectStripper(node.getAttribute('data-stripper-node'), { skipRebuild: true });
        host.querySelectorAll('.lab-stripper.is-selected').forEach(function (el) {
          if (el !== node) el.classList.remove('is-selected');
        });
        node.classList.add('is-selected');
      });

      hit.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        if (!isClientOnStripperHit(node, e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        var id = node.getAttribute('data-stripper-node');
        var s = findStripper(id);
        if (!s) return;
        selectStripper(id, { skipRebuild: true });

        /* Always animate jaws shut; strip action only if notch is on fiber. */
        clampJaws(s, node);
        playClampSnip();

        var target = findStripTarget(e.clientX, e.clientY, s);
        if (target) {
          if (global.FtthLab && typeof FtthLab.recordStripToolAtWorld === 'function') {
            FtthLab.recordStripToolAtWorld(target.id, target.x, target.y, { layer: target.layer });
          }
          startPeelSession(e, s, target, node);
          return;
        }

        startStripperDrag(e, s, node);
      });
    });
  }

  function startStripperDrag(e, s, node) {
    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = s.x;
    var oy = s.y;
    var moved = false;
    node.classList.add('is-dragging');
    document.body.classList.add('lab-stripper-dragging');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    refreshStripGuide(s, e.clientX, e.clientY, null);

    function endDrag(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      node.classList.remove('is-dragging');
      document.body.classList.remove('lab-stripper-dragging');
      openJaws(s, node);
      clearStripGuide();
    }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      s.x = Math.round(ox + dx);
      s.y = Math.round(oy + dy);
      updateStripperPosition(s, node);
      refreshStripGuide(s, ev.clientX, ev.clientY, null);
    }

    function onUp(ev) {
      endDrag(ev);
      if (moved) pushHistory();
      rebuildLayer();
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function startPeelSession(e, s, target, node) {
    var stage = target.stage || 0;
    var layerKind = target.layer || (stage === 0 ? 'jacket' : 'buffer');
    var notchOff = notchOffsetForStage(stage);
    alignStripperNotchToFiber(s, target.x, target.y, stage);
    s.laserGuideStage = stage;
    s.laserGuide = true;
    updateStripperNode(s, node);
    refreshStripGuide(s, e.clientX, e.clientY, target);
    document.body.classList.add('lab-stripper-peeling');
    try { node.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }

    var zoom = getZoom() || 1;
    var sx = e.clientX;
    var sy = e.clientY;
    var ox = s.x;
    var oy = s.y;
    var session = {
      startAlong: target.along,
      baseJacketTo: typeof target.jacketTo === 'number' ? target.jacketTo : 0,
      baseBareTo: typeof target.bareTo === 'number' ? target.bareTo : 0,
    };
    var maxPeeled = 0;
    var lastFragmentPx = 0;
    var moved = false;
    var peelCompleted = false;
    var jacketColorHex = target.jacketColorHex || '#facc15';

    function endPeel(ev) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      try { node.releasePointerCapture(ev.pointerId); } catch (err2) { /* ignore */ }
      openJaws(s, node);
      document.body.classList.remove('lab-stripper-peeling');
      if (moved && peelCompleted) {
        commitStripPeel(target.id, layerKind, session);
      }
      clearStripPeel(target.id);
      clearStripGuide();
      if (maxPeeled > 4) {
        spawnDebris(s.x, s.y - notchOff, stage, target.peelUx, target.peelUy, jacketColorHex);
        pushHistory();
        if (layerKind === 'jacket') {
          setStatus('CFS-3 · jacket stripped ' + Math.round(maxPeeled) + 'px · clamp buffer notch to peel coating');
        } else {
          setStatus('CFS-3 · buffer stripped ' + Math.round(maxPeeled) + 'px · bare glass exposed at tip');
        }
      } else {
        setStatus('CFS-3 · peel incomplete · clamp on fiber and drag toward tip');
      }
      rebuildLayer();
    }

    function onMove(ev) {
      var dx = (ev.clientX - sx) / zoom;
      var dy = (ev.clientY - sy) / zoom;
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
      moved = true;
      s.x = Math.round(ox + dx);
      s.y = Math.round(oy + dy);
      updateStripperPosition(s, node);
      paintStripperNode(s, node);

      var notch = notchWorldPos(s, stage);
      var result = applyStripDrag(target.id, notch.x, notch.y, layerKind, session);
      if (!result || !result.ok) {
        result = applyStripDrag(target.id, target.x, target.y, layerKind, session);
      }
      if (result && result.ok) {
        maxPeeled = Math.max(maxPeeled, result.peeled || 0);
        if (result.completed) peelCompleted = true;
        var peelUx = result.peelUx != null ? result.peelUx : target.peelUx;
        var peelUy = result.peelUy != null ? result.peelUy : target.peelUy;
        refreshStripGuide(s, ev.clientX, ev.clientY, {
          id: target.id,
          stage: stage,
          x: result.proj.x,
          y: result.proj.y,
        });
        if (maxPeeled - lastFragmentPx >= PEEL_FRAGMENT_PX) {
          lastFragmentPx = maxPeeled;
          spawnPeelFragment(
            result.proj.x,
            result.proj.y,
            stage,
            peelUx,
            peelUy,
            Math.min(1, maxPeeled / 80),
            jacketColorHex
          );
        }
      } else {
        refreshStripGuide(s, ev.clientX, ev.clientY, target);
      }
    }

    function onUp(ev) {
      endPeel(ev);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function updateInspector() {
    var card = document.getElementById('lab-inspector-card');
    var detail = document.getElementById('lab-inspector-detail');
    if (!card || selection.kind !== 'stripper' || !selection.id) return;
    var s = findStripper(selection.id);
    if (!s) return;
    card.innerHTML =
      '<h2>CFS-3 Stripper</h2>' +
      '<p>Fiber optic stripper · 3-notch jaw · clamp + outward peel.</p>';
    if (!detail) return;
    detail.hidden = false;
    detail.innerHTML =
      '<div class="lab-stripper-config">' +
      '<p class="lab-inspector__label">Jaw state</p>' +
      '<p class="lab-pcord-attach">' + (s.jawState === 'clamped' ? 'Clamped shut' : 'Open · spring-loaded') + '</p>' +
      '<p class="lab-inspector__label">Tri-hole blade (top)</p>' +
      '<ol class="lab-stripper-stages">' +
      '<li><strong>Top notch</strong> · 125 µm acrylate → bare glass</li>' +
      '<li><strong>Middle notch</strong> · 250–900 µm buffer tube</li>' +
      '<li><strong>Lower notch</strong> · 2–3 mm outer jacket</li>' +
      '</ol>' +
      '<p class="lab-inspector__hint">Click &amp; hold to clamp · release to spring open</p>' +
      '<button type="button" class="lab-eject-btn" data-remove-stripper="' + s.id +
      '">Remove Stripper</button>' +
      '</div>';
    var rm = detail.querySelector('[data-remove-stripper]');
    if (rm) {
      rm.addEventListener('click', function () {
        removeStripper(s.id);
      });
    }
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-stripper-tree', 'stripper')
      : document.getElementById('lab-stripper-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<div class="tool-item lab-tool lab-tool--stripper' +
      (selectedTool === 'stripper' ? ' is-selected' : '') +
      '" data-tool="stripper" data-lab-tool="stripper" draggable="true" ' +
      'role="listitem" tabindex="0" title="CFS-3 Fiber Optic Stripper">' +
      '<span class="lab-tool__mark lab-tool__mark--stripper" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>CFS-3 Stripper</strong>' +
      '<span>Vertical · 3-notch blade</span>' +
      '</span>' +
      '</div>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-tool="stripper"]');
    if (!btn) return;

    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cfs-stripper');
      }
      selectedTool = 'stripper';
      renderToolbox();
      setStatus('CFS-3 Stripper · drag onto workspace · clamp on fiber tip · peel outward');
    });

    btn.addEventListener('dragstart', function (ev) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cfs-stripper');
      }
      selectedTool = 'stripper';
      dragLib = { kind: 'stripper' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'stripper' });
      try {
        ev.dataTransfer.setData('text/plain', 'lab:stripper');
        ev.dataTransfer.setData('text/lab-drag', 'stripper');
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

  function bindStageDrop() {
    var stage = document.getElementById('lab-canvas-2d');
    var mount = document.getElementById('lab-2d-mount');
    var world = document.getElementById('lab-2d-world');
    [stage, mount, world].forEach(function (el) {
      if (!el || el.dataset.stripperDrop === '1') return;
      el.dataset.stripperDrop = '1';

      el.addEventListener('dragover', function (ev) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'stripper') || (active && active.kind === 'stripper'))) {
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
        if (kind !== 'stripper') return;
        ev.preventDefault();
        ev.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        var pt = clientToWorld(ev.clientX, ev.clientY);
        placeStripper(Math.round(pt.x), Math.round(pt.y));
        selectedTool = null;
        renderToolbox();
      });
    });
  }

  function deleteSelected() {
    if (selection.kind === 'stripper' && selection.id) {
      removeStripper(selection.id);
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
    if (id === 'cfs-stripper') return;
    selectedTool = null;
    renderToolbox();
  }

  function mount() {
    preloadStripperImages();
    renderToolbox();
    bindStageDrop();
    ensureLayer();
    rebuildLayer();
    pushHistory();
  }

  var tool = {
    id: 'cfs-stripper',
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
      applySnapshot({ strippers: [], seq: 0 });
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('cfs-stripper', tool);
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
