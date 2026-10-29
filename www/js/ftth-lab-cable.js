/**
 * Bare Fiber Cable — dual bare-end drop cable (no connectors).
 * Placement/toolbox layer; core logic lives in ftth-lab-pigtail.js (type: 'cable').
 */
(function (global) {
  'use strict';

  var selectedTool = null;
  var dragLib = null;

  function setStatus(msg) {
    if (global.FtthLab && FtthLab.setStatus) FtthLab.setStatus(msg);
  }

  function clientToWorld(clientX, clientY) {
    if (global.FtthLab && typeof FtthLab.clientToWorld2d === 'function') {
      return FtthLab.clientToWorld2d(clientX, clientY);
    }
    return { x: 0, y: 0 };
  }

  function renderToolbox() {
    var host = global.FtthLab && typeof FtthLab.gateToolboxRender === 'function'
      ? FtthLab.gateToolboxRender('lab-cable-tree', 'cable')
      : document.getElementById('lab-cable-tree');
    if (!host) return;
    host.innerHTML =
      '<div class="lab-toolbox" role="list">' +
      '<button type="button" class="lab-tool lab-tool--cable' +
      (selectedTool === 'cable' ? ' is-selected' : '') +
      '" draggable="true" data-lab-tool="cable" role="listitem">' +
      '<span class="lab-tool__mark lab-tool__mark--cable" aria-hidden="true"></span>' +
      '<span class="lab-tool__copy">' +
      '<strong>Cable</strong>' +
      '<span>Bare fiber both ends</span>' +
      '</span>' +
      '</button>' +
      '</div>';
    bindToolbox(host);
    if (global.FtthLab && typeof FtthLab.applyFtthLabToolboxIcons === 'function') {
      FtthLab.applyFtthLabToolboxIcons();
    }
  }

  function bindToolbox(host) {
    var btn = host.querySelector('[data-lab-tool="cable"]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cable');
      }
      selectedTool = 'cable';
      renderToolbox();
      setStatus('Cable · drag onto canvas · prep and splice both bare ends');
    });
    btn.addEventListener('dragstart', function (e) {
      if (global.FtthLab && typeof FtthLab.claimToolboxTool === 'function') {
        FtthLab.claimToolboxTool('cable');
      }
      selectedTool = 'cable';
      dragLib = { kind: 'cable' };
      if (global.FtthLab && FtthLab.beginDrag) FtthLab.beginDrag({ kind: 'cable' });
      try {
        e.dataTransfer.setData('text/plain', 'lab:cable');
        e.dataTransfer.setData('text/lab-drag', 'cable');
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
      if (!el || el.dataset.cableDrop === '1') return;
      el.dataset.cableDrop = '1';
      el.addEventListener('dragover', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        if (!((dragLib && dragLib.kind === 'cable') || (active && active.kind === 'cable'))) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      });
      el.addEventListener('drop', function (e) {
        var active = global.FtthLab && FtthLab.getActiveDrag && FtthLab.getActiveDrag();
        var kind = (e.dataTransfer && e.dataTransfer.getData('text/lab-drag')) ||
          (active && active.kind) || (dragLib && dragLib.kind) || '';
        if (kind !== 'cable') return;
        e.preventDefault();
        e.stopPropagation();
        dragLib = null;
        if (global.FtthLab && FtthLab.endDrag) FtthLab.endDrag();
        selectedTool = 'cable';
        var pt = clientToWorld(e.clientX, e.clientY);
        if (global.FtthLab && typeof FtthLab.placeCable === 'function') {
          FtthLab.placeCable(Math.round(pt.x - 8), Math.round(pt.y - 10));
        }
      });
    });
  }

  function mount() {
    renderToolbox();
    bindStageDrop();
  }

  function onToolboxClaim(payload) {
    var id = payload && payload.toolId;
    if (id === 'cable') return;
    if (selectedTool) {
      selectedTool = null;
      renderToolbox();
    }
  }

  var tool = {
    id: 'cable',
    category: 'FIBER JUMPERS',
    mount: mount,
    onToolboxClaim: onToolboxClaim,
    onLabConfigChanged: function (payload) {
      if (global.FtthLab && typeof FtthLab.handleToolboxConfigChange === 'function') {
        FtthLab.handleToolboxConfigChange('cable', 'lab-cable-tree', renderToolbox, payload && payload.config);
      } else {
        renderToolbox();
      }
    },
  };

  function tryRegister() {
    if (global.FtthLab && typeof FtthLab.registerTool === 'function') {
      FtthLab.registerTool('cable', tool);
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
