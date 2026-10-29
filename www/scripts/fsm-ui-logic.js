  var instances = {};

  function camelToKebab(name) {
    return name.replace(/([A-Z])/g, function (m) {
      return '-' + m.toLowerCase();
    });
  }

  function destroyInstance(root) {
    var inst = instances[root];
    if (!inst) return;
    if (inst.animFrame) cancelAnimationFrame(inst.animFrame);
    if (inst.toastTimer) clearTimeout(inst.toastTimer);
    if (inst.heatInterval) clearInterval(inst.heatInterval);
    if (inst.keyHandler) document.removeEventListener('keydown', inst.keyHandler);
    if (inst.resizeHandler) window.removeEventListener('resize', inst.resizeHandler);
    delete instances[root];
  }

  function mount(root, opts) {
    if (!root) return null;
    destroyInstance(root);
    opts = opts || {};

    var state = {
      powered: true,
      selectedClamp: 'L',
      clampsClosed: { L: true, R: true },
      ovenLidOpen: false,
      fiberPlaced: { L: false, R: false },
      alignment: { x: 0.0, y: 0.0 },
      stageOffset: { x: 0, y: 0 },
      clampOffset: { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } },
      splicing: false,
      heating: false,
      heatProgress: 0,
      mode: 'SM AUTO',
      alarm: false,
      statusText: 'READY',
      moveTimer: null,
      heatInterval: null,
      active: false,
    };

    var CLAMP_BASE = { L: { left: 4, top: 18 }, R: { right: 4, top: 18 } };
    var PX_STEP = 1.5;
    var OFFSET_LIMIT = 30;
    var listeners = {};
    var canvases = [];
    var animFrame = null;
    var time = 0;
    var toastTimer;

    function q(name) {
      return root.querySelector('.fsm-' + camelToKebab(name));
    }

    function showToast(msg, type) {
      var t = q('toast');
      if (!t) return;
      t.textContent = msg;
      t.className = 'fsm-toast show' + (type ? ' ' + type : '');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () {
        t.className = 'fsm-toast';
      }, 2500);
    }

    function requirePower() {
      if (!state.powered) {
        showToast('Power off', 'error');
        return false;
      }
      return true;
    }

    function on(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
      return function off() {
        listeners[evt] = (listeners[evt] || []).filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(evt, payload) {
      (listeners[evt] || []).forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error(err);
        }
      });
      if (global.CustomEvent) {
        document.dispatchEvent(new CustomEvent('fusion-splicer:' + evt, { detail: payload }));
      }
    }

    function syncClampLidZ(assembly, lid, isOpen) {
      if (assembly) assembly.classList.toggle('lid-open', !!isOpen);
      if (lid) lid.classList.toggle('is-open', !!isOpen);
    }

    function togglePower() {
      state.powered = !state.powered;
      var led = q('powerLed');
      var ledPwr = q('ledPwr');
      if (state.powered) {
        if (led) led.classList.add('on');
        if (ledPwr) ledPwr.classList.add('green-on');
        showToast('System Powered ON', 'success');
      } else {
        if (led) led.classList.remove('on');
        if (ledPwr) ledPwr.classList.remove('green-on');
        var ledArc = q('ledArc');
        var ledErr = q('ledErr');
        if (ledArc) ledArc.classList.remove('orange-on');
        if (ledErr) ledErr.classList.remove('red-on');
        showToast('System Powered OFF', 'error');
      }
      emit('power', { powered: state.powered });
    }

    function setOvenLidOpen(open) {
      state.ovenLidOpen = !!open;
      var mod = q('heatOvenModule');
      if (mod) mod.classList.toggle('lid-open', state.ovenLidOpen);
      var btn = q('heatOvenLidBtn');
      if (btn) btn.textContent = state.ovenLidOpen ? 'OPEN' : 'LID';
      emit('ovenLid', { open: state.ovenLidOpen });
    }

    function toggleOvenLid() {
      if (!requirePower()) return;
      setOvenLidOpen(!state.ovenLidOpen);
      showToast(
        state.ovenLidOpen ? 'Heat oven lid OPEN' : 'Heat oven lid CLOSED',
        state.ovenLidOpen ? 'warning' : 'success'
      );
    }

    function selectClamp(side) {
      if (side !== 'L' && side !== 'R') return;
      var asmL = q('clampAssemblyL');
      var asmR = q('clampAssemblyR');
      if (asmL) asmL.classList.remove('selected');
      if (asmR) asmR.classList.remove('selected');
      state.selectedClamp = side;
      var asm = q('clampAssembly' + side);
      if (asm) asm.classList.add('selected');
      var label = side === 'L' ? 'L-CLAMP' : 'R-CLAMP';
      var disp = q('clampSelectDisplay');
      if (disp) {
        disp.textContent = 'SEL: ' + label;
        disp.style.color = 'var(--accent-blue)';
      }
      showToast('Selected: ' + label, '');
      emit('clampSelect', { side: side });
    }

    function applyClampTransform(side) {
      var off = state.clampOffset[side];
      var el = q('clampAssembly' + side);
      if (!el) return;
      if (side === 'L') {
        el.style.left = CLAMP_BASE.L.left + off.x + 'px';
        el.style.right = '';
        el.style.top = CLAMP_BASE.L.top + off.y + 'px';
      } else {
        el.style.right = CLAMP_BASE.R.right + off.x + 'px';
        el.style.left = '';
        el.style.top = CLAMP_BASE.R.top + off.y + 'px';
      }
    }

    function syncAlignmentFromClamps() {
      state.alignment.x =
        (Math.abs(state.clampOffset.L.x - state.clampOffset.R.x) / PX_STEP) * 0.001;
      state.alignment.y =
        (Math.abs(state.clampOffset.L.y - state.clampOffset.R.y) / PX_STEP) * 0.001;
      var xVal = q('xVal');
      var yVal = q('yVal');
      if (xVal) xVal.textContent = state.alignment.x.toFixed(3);
      if (yVal) yVal.textContent = state.alignment.y.toFixed(3);

      var cx = (state.clampOffset.L.x - state.clampOffset.R.x) * 0.25;
      var cy = (state.clampOffset.L.y + state.clampOffset.R.y) * 0.25;
      state.stageOffset.x = cx;
      state.stageOffset.y = cy;
      var stage = q('alignmentStage');
      if (stage) stage.style.transform = 'translate(' + cx + 'px, ' + cy + 'px)';
    }

    function nudgeSelectedClamp(dir) {
      var side = state.selectedClamp;
      var off = state.clampOffset[side];
      if (dir === 'UP') off.y = Math.max(-OFFSET_LIMIT, off.y - PX_STEP);
      if (dir === 'DOWN') off.y = Math.min(OFFSET_LIMIT, off.y + PX_STEP);
      if (dir === 'LEFT') off.x = Math.max(-OFFSET_LIMIT, off.x - PX_STEP);
      if (dir === 'RIGHT') off.x = Math.min(OFFSET_LIMIT, off.x + PX_STEP);
      applyClampTransform(side);
      syncAlignmentFromClamps();

      var moveInd = q('moveIndicator');
      var offsetDisp = q('offsetDisplay');
      if (moveInd) moveInd.classList.add('active');
      var xSign = off.x >= 0 ? '+' : '';
      var ySign = off.y >= 0 ? '+' : '';
      if (offsetDisp) {
        offsetDisp.textContent =
          (side === 'L' ? 'L' : 'R') +
          ': X:' +
          xSign +
          ((off.x / PX_STEP) * 0.001).toFixed(3) +
          ' Y:' +
          ySign +
          ((off.y / PX_STEP) * 0.001).toFixed(3);
        offsetDisp.classList.add('active');
      }

      clearTimeout(state.moveTimer);
      state.moveTimer = setTimeout(function () {
        if (moveInd) moveInd.classList.remove('active');
        if (offsetDisp) offsetDisp.classList.remove('active');
      }, 2000);

      emit('clampNudge', { side: side, offset: { x: off.x, y: off.y }, dir: dir });
    }

    function dpadPress(dir) {
      if (!requirePower()) return;
      if (dir === 'OK') {
        var label = state.selectedClamp === 'L' ? 'L-CLAMP' : 'R-CLAMP';
        showToast(label + ' Position Confirmed', 'success');
        emit('clampConfirm', { side: state.selectedClamp });
        return;
      }
      nudgeSelectedClamp(dir);
      showToast(
        'Align ' +
          state.selectedClamp +
          ': ' +
          dir +
          ' → ' +
          state.clampOffset[state.selectedClamp].x.toFixed(1) +
          ' / ' +
          state.clampOffset[state.selectedClamp].y.toFixed(1) +
          ' px',
        ''
      );
    }

    function setFiberPlaced(side, placed) {
      if (side !== 'L' && side !== 'R') return;
      state.fiberPlaced[side] = !!placed;
      var groove = q('grooveFiber' + side);
      var clampF = q('clampFiber' + side);
      var lock = q('fiberLock' + side);
      var clampLock = q('clampFiberLock' + side);
      [groove, clampF, lock, clampLock].forEach(function (el) {
        if (!el) return;
        el.hidden = !placed;
        el.classList.remove('visible', 'locked');
      });
      if (placed && !state.clampsClosed[side]) {
        if (groove) groove.classList.add('visible');
        if (clampF) clampF.classList.add('visible');
      }
      if (placed && state.clampsClosed[side]) {
        if (lock) lock.classList.add('locked');
        if (clampLock) clampLock.classList.add('locked');
      }
      emit('fiberPlaced', { side: side, placed: !!placed });
    }

    function clearAllFibers() {
      setFiberPlaced('L', false);
      setFiberPlaced('R', false);
      [
        'grooveFiberL',
        'grooveFiberR',
        'fiberLockL',
        'fiberLockR',
        'clampFiberL',
        'clampFiberR',
        'clampFiberLockL',
        'clampFiberLockR',
      ].forEach(function (name) {
        var el = q(name);
        if (!el) return;
        el.classList.remove('visible', 'locked');
        el.hidden = true;
      });
    }

    function toggleClampLid(side) {
      if (!requirePower()) return;
      if (side !== 'L' && side !== 'R') return;

      state.clampsClosed[side] = !state.clampsClosed[side];
      var assembly = q('clampAssembly' + side);
      var ind = q('clampInd' + side);
      var grooveFiber = q('grooveFiber' + side);
      var fiberLock = q('fiberLock' + side);
      var clampFiber = q('clampFiber' + side);
      var clampFiberLock = q('clampFiberLock' + side);
      var lid = q('clampLid' + side);
      var isOpen = !state.clampsClosed[side];

      syncClampLidZ(assembly, lid, isOpen);
      if (state.clampsClosed[side]) {
        if (ind) ind.classList.remove('open');
        if (grooveFiber) grooveFiber.classList.remove('visible');
        if (clampFiber) clampFiber.classList.remove('visible');
        if (state.fiberPlaced[side]) {
          if (fiberLock) fiberLock.classList.add('locked');
          if (clampFiberLock) clampFiberLock.classList.add('locked');
          showToast('Clamp ' + side + ' CLOSED — Fiber LOCKED', 'success');
        } else {
          showToast('Clamp ' + side + ' CLOSED', 'success');
        }
      } else {
        if (ind) ind.classList.add('open');
        if (fiberLock) fiberLock.classList.remove('locked');
        if (clampFiberLock) clampFiberLock.classList.remove('locked');
        if (state.fiberPlaced[side]) {
          if (grooveFiber) grooveFiber.classList.add('visible');
          if (clampFiber) clampFiber.classList.add('visible');
          showToast('Clamp ' + side + ' OPEN', 'warning');
        } else {
          showToast('Clamp ' + side + ' OPEN — empty (await fiber)', 'warning');
        }
      }
      emit('clampLid', { side: side, closed: state.clampsClosed[side] });
    }

    function xPress() {
      if (!requirePower()) return;
      showToast('Cancel / Back', 'warning');
      emit('button', { id: 'X' });
    }

    function oPress() {
      if (!requirePower()) return;
      showToast('Option / Menu', '');
      emit('button', { id: 'O' });
    }

    function heatPress() {
      if (!requirePower()) return;
      if (state.heating) return showToast('Heating already in progress', 'warning');
      if (!state.ovenLidOpen) return showToast('Open heat oven lid first', 'warning');

      state.heating = true;
      state.heatProgress = 0;
      showToast('HEAT: Sleeve shrink started', 'warning');
      var statusText = q('statusText');
      if (statusText) {
        statusText.textContent = 'HEATING';
        statusText.style.color = 'var(--accent-orange)';
      }
      var plate = q('heatOvenPlate');
      var slot = q('heatOvenSlot');
      var glow = q('heatOvenGlow');
      var led = q('heatOvenLed');
      if (plate) plate.classList.add('heating');
      if (slot) slot.classList.add('heating');
      if (glow) glow.classList.add('active');
      if (led) led.classList.add('on');

      var fill = q('heatBarFill');
      if (state.heatInterval) clearInterval(state.heatInterval);
      state.heatInterval = setInterval(function () {
        state.heatProgress += 2;
        if (fill) fill.style.width = state.heatProgress + '%';
        if (state.heatProgress >= 100) {
          clearInterval(state.heatInterval);
          state.heatInterval = null;
          state.heating = false;
          if (fill) fill.style.width = '0%';
          if (plate) plate.classList.remove('heating');
          if (slot) slot.classList.remove('heating');
          if (glow) glow.classList.remove('active');
          if (led) led.classList.remove('on');
          if (slot) slot.style.boxShadow = '';
          if (statusText) {
            statusText.textContent = 'READY';
            statusText.style.color = '';
          }
          showToast('HEAT: Complete', 'success');
          emit('heatComplete', {});
        }
      }, 60);
      emit('heatStart', {});
    }

    function almPress() {
      if (!requirePower()) return;
      state.alarm = !state.alarm;
      var led = q('ledErr');
      var statusText = q('statusText');
      if (state.alarm) {
        if (led) led.classList.add('red-on');
        showToast('ALARM: Error detected!', 'error');
        if (statusText) {
          statusText.textContent = 'ALARM';
          statusText.style.color = 'var(--accent-red)';
        }
      } else {
        if (led) led.classList.remove('red-on');
        showToast('ALARM: Cleared', 'success');
        if (statusText) {
          statusText.textContent = 'READY';
          statusText.style.color = '';
        }
      }
      emit('alarm', { on: state.alarm });
    }

    function andPress() {
      if (!requirePower()) return;
      showToast('AND: Additional function', '');
      emit('button', { id: 'AND' });
    }

    function resetPress() {
      if (!requirePower()) return;
      state.alignment = { x: 0, y: 0 };
      state.stageOffset = { x: 0, y: 0 };
      state.clampOffset = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };
      state.alarm = false;
      state.splicing = false;
      state.heating = false;
      state.heatProgress = 0;
      if (state.heatInterval) {
        clearInterval(state.heatInterval);
        state.heatInterval = null;
      }
      applyClampTransform('L');
      applyClampTransform('R');
      var stage = q('alignmentStage');
      if (stage) stage.style.transform = 'translate(0, 0)';
      var xVal = q('xVal');
      var yVal = q('yVal');
      if (xVal) xVal.textContent = '0.000';
      if (yVal) yVal.textContent = '0.000';
      var ledErr = q('ledErr');
      var ledArc = q('ledArc');
      var arcGlow = q('arcGlow');
      if (ledErr) ledErr.classList.remove('red-on');
      if (ledArc) ledArc.classList.remove('orange-on');
      if (arcGlow) arcGlow.classList.remove('active');
      var heatBarFill = q('heatBarFill');
      if (heatBarFill) heatBarFill.style.width = '0%';
      var statusText = q('statusText');
      if (statusText) {
        statusText.textContent = 'READY';
        statusText.style.color = '';
      }
      var lossEst = q('lossEst');
      if (lossEst) lossEst.textContent = 'EST.LOSS: —';
      var moveIndicator = q('moveIndicator');
      var offsetDisplay = q('offsetDisplay');
      if (moveIndicator) moveIndicator.classList.remove('active');
      if (offsetDisplay) offsetDisplay.classList.remove('active');
      var plate = q('heatOvenPlate');
      var slot = q('heatOvenSlot');
      var glow = q('heatOvenGlow');
      var ovenLed = q('heatOvenLed');
      if (plate) plate.classList.remove('heating');
      if (slot) {
        slot.classList.remove('heating');
        slot.style.boxShadow = '';
      }
      if (glow) glow.classList.remove('active');
      if (ovenLed) ovenLed.classList.remove('on');
      clearAllFibers();
      showToast('System RESET — empty chamber', 'warning');
      emit('reset', {});
    }

    function setPress() {
      if (!requirePower()) return;
      if (!state.clampsClosed.L || !state.clampsClosed.R) {
        return showToast('Close both clamps first!', 'error');
      }
      if (!state.fiberPlaced.L || !state.fiberPlaced.R) {
        return showToast('No fiber loaded — use external placeFiber()', 'warning');
      }
      if (state.splicing) return showToast('Splice already in progress', 'warning');

      state.splicing = true;
      var ledArc = q('ledArc');
      var statusText = q('statusText');
      if (ledArc) ledArc.classList.add('orange-on');
      if (statusText) {
        statusText.textContent = 'SPLICING';
        statusText.style.color = 'var(--accent-blue)';
      }
      showToast('SET: Auto splice initiated', 'success');
      emit('spliceStart', {});

      var step = 0;
      var totalSteps = 45;
      var iv = setInterval(function () {
        step += 1;
        var progress = step / totalSteps;
        var decay = 1 - progress * 0.08;
        state.clampOffset.L.x *= decay;
        state.clampOffset.L.y *= decay;
        state.clampOffset.R.x *= decay;
        state.clampOffset.R.y *= decay;
        applyClampTransform('L');
        applyClampTransform('R');
        state.alignment.x = Math.max(0, state.alignment.x * (1 - progress * 0.5));
        state.alignment.y = Math.max(0, state.alignment.y * (1 - progress * 0.5));
        var xVal = q('xVal');
        var yVal = q('yVal');
        if (xVal) xVal.textContent = state.alignment.x.toFixed(3);
        if (yVal) yVal.textContent = state.alignment.y.toFixed(3);
        state.stageOffset.x *= 1 - progress * 0.08;
        state.stageOffset.y *= 1 - progress * 0.08;
        var stage = q('alignmentStage');
        if (stage) {
          stage.style.transform =
            'translate(' + state.stageOffset.x + 'px, ' + state.stageOffset.y + 'px)';
        }
        var arcGlow = q('arcGlow');
        if (progress > 0.6 && arcGlow) arcGlow.classList.add('active');
        if (step >= totalSteps) {
          clearInterval(iv);
          state.splicing = false;
          state.clampOffset = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } };
          state.stageOffset = { x: 0, y: 0 };
          state.alignment = { x: 0, y: 0 };
          applyClampTransform('L');
          applyClampTransform('R');
          if (stage) stage.style.transform = 'translate(0, 0)';
          if (xVal) xVal.textContent = '0.000';
          if (yVal) yVal.textContent = '0.000';
          if (statusText) {
            statusText.textContent = 'SPLICE OK';
            statusText.style.color = 'var(--accent-green)';
          }
          var lossEst = q('lossEst');
          if (lossEst) lossEst.textContent = 'EST.LOSS: 0.01 dB';
          showToast('Splice Complete — Loss: 0.01 dB', 'success');
          setTimeout(function () {
            if (ledArc) ledArc.classList.remove('orange-on');
            if (arcGlow) arcGlow.classList.remove('active');
          }, 3000);
          emit('spliceComplete', { lossDb: 0.01 });
        }
      }, 80);
    }

    function initCanvas(className, axis) {
      var canvas = root.querySelector('.' + className);
      if (!canvas || !canvas.parentElement) return null;
      var rect = canvas.parentElement.getBoundingClientRect();
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      return { canvas: canvas, ctx: canvas.getContext('2d'), axis: axis };
    }

    function drawCamera(ctx, w, h, axis, t) {
      ctx.fillStyle = '#060e1e';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(0,180,255,0.06)';
      ctx.lineWidth = 1;
      var gridSize = 30;
      var x;
      var y;
      for (x = 0; x < w; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (y = 0; y < h; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,200,0,0.25)';
      ctx.beginPath();
      ctx.moveTo(w / 2, 0);
      ctx.lineTo(w / 2, h);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      if (state.fiberPlaced.L || state.fiberPlaced.R) {
        var centerY = h / 2;
        var gap = state.splicing ? Math.max(0, 8 * (1 - (t % 100) / 40)) : 8;
        var fiberWidth = 12;
        if (state.fiberPlaced.L) {
          var leftEnd = w / 2 - gap + state.clampOffset.L.x * 0.5;
          var offLY = state.clampOffset.L.y * 0.3;
          ctx.fillStyle = 'rgba(255,213,79,0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(
              10,
              centerY - fiberWidth / 2 + offLY,
              Math.max(2, leftEnd - 10),
              fiberWidth,
              fiberWidth / 2
            );
          } else {
            ctx.rect(10, centerY - fiberWidth / 2 + offLY, Math.max(2, leftEnd - 10), fiberWidth);
          }
          ctx.fill();
        }
        if (state.fiberPlaced.R) {
          var rightStart = w / 2 + gap - state.clampOffset.R.x * 0.5;
          var offRY = state.clampOffset.R.y * 0.3;
          ctx.fillStyle = 'rgba(255,213,79,0.85)';
          ctx.beginPath();
          if (ctx.roundRect) {
            ctx.roundRect(
              rightStart,
              centerY - fiberWidth / 2 + offRY,
              Math.max(2, w - 10 - rightStart),
              fiberWidth,
              fiberWidth / 2
            );
          } else {
            ctx.rect(
              rightStart,
              centerY - fiberWidth / 2 + offRY,
              Math.max(2, w - 10 - rightStart),
              fiberWidth
            );
          }
          ctx.fill();
        }
      }

      var arcGlow = q('arcGlow');
      if (arcGlow && arcGlow.classList.contains('active')) {
        var glow = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, 40);
        glow.addColorStop(0, 'rgba(255,255,255,0.9)');
        glow.addColorStop(0.2, 'rgba(0,180,255,0.8)');
        glow.addColorStop(1, 'rgba(0,0,255,0)');
        ctx.fillStyle = glow;
        ctx.fillRect(w / 2 - 50, h / 2 - 50, 100, 100);
      }

      ctx.fillStyle = 'rgba(0,180,255,0.15)';
      ctx.font = '24px Orbitron, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(axis + '-VIEW', w - 16, h - 12);

      var scanY = (t * 0.5) % h;
      ctx.fillStyle = 'rgba(0,180,255,0.06)';
      ctx.fillRect(0, scanY - 2, w, 4);
    }

    function animate() {
      time += 1;
      canvases.forEach(function (c) {
        drawCamera(c.ctx, c.canvas.width, c.canvas.height, c.axis, time);
      });
      animFrame = requestAnimationFrame(animate);
    }

    function bindUi() {
      root.addEventListener('click', function (e) {
        var t = e.target;
        if (t.closest('.fsm-power-btn')) {
          e.stopPropagation();
          togglePower();
          return;
        }
        if (t.closest('.fsm-heat-oven-lid') || t.closest('.fsm-heat-oven-lid-btn')) {
          e.stopPropagation();
          toggleOvenLid();
          return;
        }
        if (t.closest('.fsm-clamp-lid-l')) {
          e.stopPropagation();
          toggleClampLid('L');
          return;
        }
        if (t.closest('.fsm-clamp-lid-r')) {
          e.stopPropagation();
          toggleClampLid('R');
          return;
        }
        if (t.closest('.fsm-clamp-assembly-l')) {
          e.stopPropagation();
          selectClamp('L');
          return;
        }
        if (t.closest('.fsm-clamp-assembly-r')) {
          e.stopPropagation();
          selectClamp('R');
          return;
        }
        if (t.closest('.fsm-dpad-up')) {
          e.stopPropagation();
          dpadPress('UP');
          return;
        }
        if (t.closest('.fsm-dpad-down')) {
          e.stopPropagation();
          dpadPress('DOWN');
          return;
        }
        if (t.closest('.fsm-dpad-left')) {
          e.stopPropagation();
          dpadPress('LEFT');
          return;
        }
        if (t.closest('.fsm-dpad-right')) {
          e.stopPropagation();
          dpadPress('RIGHT');
          return;
        }
        if (t.closest('.fsm-dpad-center')) {
          e.stopPropagation();
          dpadPress('OK');
          return;
        }
        if (t.closest('.fsm-x-btn')) {
          e.stopPropagation();
          xPress();
          return;
        }
        if (t.closest('.fsm-o-btn')) {
          e.stopPropagation();
          oPress();
          return;
        }
        if (t.closest('.fsm-heat-btn')) {
          e.stopPropagation();
          heatPress();
          return;
        }
        if (t.closest('.fsm-alm-btn')) {
          e.stopPropagation();
          almPress();
          return;
        }
        if (t.closest('.fsm-and-btn')) {
          e.stopPropagation();
          andPress();
          return;
        }
        if (t.closest('.fsm-reset-btn')) {
          e.stopPropagation();
          resetPress();
          return;
        }
        if (t.closest('.fsm-set-btn')) {
          e.stopPropagation();
          setPress();
        }
      });
    }

    function setActive(active) {
      state.active = !!active;
      if (!state.active) {
        try {
          if (document.activeElement && root.contains(document.activeElement)) {
            document.activeElement.blur();
          }
        } catch (err) {
          /* ignore */
        }
      }
    }

    var keyHandler = function (e) {
      if (!state.active) return;
      var key = e.key;
      if (key === 'ArrowUp') {
        e.preventDefault();
        dpadPress('UP');
      }
      if (key === 'ArrowDown') {
        e.preventDefault();
        dpadPress('DOWN');
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        dpadPress('LEFT');
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        dpadPress('RIGHT');
      }
      if (key === 'Enter') {
        e.preventDefault();
        dpadPress('OK');
      }
      if (key === 'Tab') {
        e.preventDefault();
        selectClamp(state.selectedClamp === 'L' ? 'R' : 'L');
      }
      if (key === 'o' || key === 'O') {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          toggleOvenLid();
        }
      }
    };

    var resizeHandler = function () {
      canvases.length = 0;
      if (animFrame) cancelAnimationFrame(animFrame);
      var cx = initCanvas('fsm-canvas-x', 'X');
      var cy = initCanvas('fsm-canvas-y', 'Y');
      if (cx) canvases.push(cx);
      if (cy) canvases.push(cy);
      animate();
    };

    bindUi();
    document.addEventListener('keydown', keyHandler);
    window.addEventListener('resize', resizeHandler);

    selectClamp('L');
    clearAllFibers();
    setOvenLidOpen(false);
    var xVal = q('xVal');
    var yVal = q('yVal');
    var lossEst = q('lossEst');
    var statusText = q('statusText');
    if (xVal) xVal.textContent = '0.000';
    if (yVal) yVal.textContent = '0.000';
    if (lossEst) lossEst.textContent = 'EST.LOSS: —';
    if (statusText) statusText.textContent = 'READY';
    resizeHandler();
    emit('ready', { empty: true });

    var api = {
      getState: function () {
        return JSON.parse(JSON.stringify(state));
      },
      on: on,
      showToast: showToast,
      togglePower: togglePower,
      selectClamp: selectClamp,
      toggleClampLid: toggleClampLid,
      toggleOvenLid: toggleOvenLid,
      setOvenLidOpen: setOvenLidOpen,
      dpadPress: dpadPress,
      nudgeSelectedClamp: nudgeSelectedClamp,
      setFiberPlaced: setFiberPlaced,
      clearAllFibers: clearAllFibers,
      placeFiber: function (side) {
        setFiberPlaced(side, true);
      },
      removeFiber: function (side) {
        setFiberPlaced(side, false);
      },
      heatPress: heatPress,
      almPress: almPress,
      andPress: andPress,
      resetPress: resetPress,
      setPress: setPress,
      xPress: xPress,
      oPress: oPress,
      setActive: setActive,
      root: root,
    };

    instances[root] = {
      api: api,
      animFrame: animFrame,
      toastTimer: toastTimer,
      heatInterval: state.heatInterval,
      keyHandler: keyHandler,
      resizeHandler: resizeHandler,
    };

    return api;
  }
