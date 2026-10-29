/**

 * PathwayPropertiesModal — Persistent bottom sheet inside #simulator-container.

 */

(function (global) {

  'use strict';



  var bridge = null;

  var activeTab = 'info';

  var panelEl = null;

  var listenersBound = false;

  var usedBatches = Object.create(null);



  function b() { return bridge; }

  function sim() { return b()?.getSim?.(); }



  function getPanelHost() {

    return b()?.getBottomPanelHost?.() ||

      document.getElementById('sim-workspace-overlays') ||

      document.body;

  }

  function checkDuplicateBatch(path) {
    if (!path || (path.type !== 'fiber' && path.type !== 'Fiber_Cable')) return null;
    var batch = Number(path.batch || 1);
    var kind = path.kind || null;
    var capacity = path.capacity != null ? path.capacity : null;
    var cableId = String(path.id || '');

    /* Prefer core capacity+batch+kind check (same as toolbox / drawing engine). */
    if (b()?.isBatchDuplicated) {
      if (b().isBatchDuplicated(batch, kind, capacity, cableId)) {
        return {
          isDuplicate: true,
          batch: batch,
          capacity: capacity,
          kind: kind,
          otherCables: [],
        };
      }
      return null;
    }

    var allCables = b()?.getAllCables?.() || b()?.getSim?.()?.fiberCablePaths || [];
    usedBatches = Object.create(null);
    var kindKey = kind ? String(kind) : '';
    var capKey = Number(capacity) || 0;

    allCables.forEach(function (c) {
      if (!c || String(c.id) === cableId) return;
      if (Number(c.batch) !== batch) return;
      if (kindKey && String(c.kind || '') !== kindKey) return;
      if (capKey > 0 && Number(c.capacity) !== capKey) return;
      var cName = String(c.name || c.asBuiltId || c.id);
      if (!usedBatches[batch]) usedBatches[batch] = [];
      usedBatches[batch].push(cName);
    });

    if (usedBatches[batch] && usedBatches[batch].length > 0) {
      return {
        isDuplicate: true,
        batch: batch,
        capacity: capacity,
        kind: kind,
        otherCables: usedBatches[batch],
      };
    }
    return null;
  }

  function clearDuplicationWarning() {
    clearStatusBarWarning();
    if (b()?.syncStatusBarDuplicationDisplay) {
      b().syncStatusBarDuplicationDisplay(null);
    }
  }

  function onPathMerged(payload) {
    clearDuplicationWarning();
    var cableId = payload && payload.cableId;
    if (!cableId) return;
    var S = sim();
    var focus = S?.ui?.topologyTreeFocus;
    if (focus && focus.kind === 'cable' && String(focus.pathId) === String(cableId)) {
      try { refresh(); } catch (e) { /* ignore */ }
    }
  }

  function updateStatusBarWithWarning(warning) {
    /* Prefer core dual-slot sync (Active Path ↔ dup badge). Avoid wiping child nodes. */
    if (b()?.syncStatusBarDuplicationDisplay) {
      if (warning && warning.isDuplicate) {
        var label = 'Batch ' + warning.batch + ' Duplicated ❗';
        b().syncStatusBarDuplicationDisplay(label);
      } else {
        b().syncStatusBarDuplicationDisplay(null);
      }
      return;
    }
    var statusHint = document.getElementById('status-bar-push-hint');
    if (!statusHint) return;
    var dupEl = document.getElementById('status-bar-dup-badge');
    var activeEl = document.getElementById('status-bar-active-path');
    if (warning && warning.isDuplicate) {
      var text = 'Batch ' + warning.batch + ' Duplicated ❗';
      if (dupEl && activeEl) {
        activeEl.classList.add('is-hidden');
        dupEl.textContent = text;
        dupEl.classList.add('is-visible');
        dupEl.removeAttribute('hidden');
      } else {
        statusHint.textContent = text;
      }
    } else {
      clearStatusBarWarning();
    }
  }

  function clearStatusBarWarning() {
    if (b()?.syncStatusBarDuplicationDisplay) {
      b().syncStatusBarDuplicationDisplay(null);
      return;
    }
    var dupEl = document.getElementById('status-bar-dup-badge');
    var activeEl = document.getElementById('status-bar-active-path');
    if (dupEl) {
      dupEl.classList.remove('is-visible');
      dupEl.setAttribute('hidden', '');
      dupEl.textContent = '';
    }
    if (activeEl) {
      activeEl.classList.remove('is-hidden');
    }
    var statusHint = document.getElementById('status-bar-push-hint');
    if (statusHint && !activeEl) {
      statusHint.textContent = '—';
      statusHint.style.backgroundColor = '';
    }
  }



  function mountPanelToHost() {

    if (!panelEl) return;

    var host = getPanelHost();

    if (host && panelEl.parentElement !== host) {

      host.appendChild(panelEl);

    }

  }



  function syncPanelLayout(isOpen) {

    var open = !!isOpen;

    var host = getPanelHost();

    var view = document.getElementById('virtual-city-view');

    var main = document.getElementById('canvas-main');

    if (host) host.classList.toggle('path-panel-host--open', open);

    if (panelEl) {
      panelEl.classList.toggle('is-expanded', open);
      panelEl.classList.toggle('active', open);
      if (open) {
        panelEl.classList.remove('hidden');
        panelEl.style.display = 'flex';
      } else {
        panelEl.style.display = '';
      }
    }

    if (view) view.classList.toggle('path-panel-open', open);

    if (main) main.classList.toggle('path-panel-open', open);

    b()?.syncPathBottomPanelLayout?.(open);

  }



  function escapeHtml(str) {

    return String(str ?? '')

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;');

  }



  function getExcavLabel(kind) {

    var tools = b()?.getExcavationTools?.() || [];

    for (var i = 0; i < tools.length; i++) {

      if (tools[i].routeKind === kind) return tools[i].label;

    }

    return kind || '—';

  }



  function getPathMeta(ref) {

    if (!ref) return null;

    var path = b()?.findPathByRef?.(ref);

    if (!path) return null;

    var cs = sim()?.layout?.cellSize || 50;

    var editor = global.FTTHPathwayEditor;

    var lengthPx = editor?.getPathLength?.(path, cs) || 0;

    var lengthM = (lengthPx / (cs || 50)).toFixed(1);

    return {

      ref: ref,

      path: path,

      lengthM: lengthM,

      typeLabel: ref.type === 'excavation'
        ? getExcavLabel(path.kind)
        : (path.name || formatCableTypeLabel(path)),

    };

  }

  function formatCableTypeLabel(path) {
    var cap = path.capacity || '?';
    var kind = path.kind === 'lastmile' ? 'Last Mile' : 'FTTH Main';
    return kind + ' · ' + cap + 'F' + (path.batch ? ' (batch ' + path.batch + ')' : '');
  }

  function renderTrenchCablesSection(trenchId) {
    var cables = b()?.getCablesOnTrench?.(trenchId) || [];
    if (!cables.length) {
      return '<p class="pathway-bottom-panel__hint">No cables registered on this trench.</p>';
    }
    var items = cables.map(function (cable) {
      var lenM = (b()?.pathLengthMeters?.(cable) || 0).toFixed(1);
      var label = escapeHtml(b()?.formatCableAsBuiltId?.(cable) || cable.name || ((cable.capacity || '?') + 'F' + (cable.batch || 1)));
      return '<li><span class="font-mono text-fiber-cyan">' + label + '</span> — <span class="font-mono">' + escapeHtml(lenM) + '</span> m</li>';
    }).join('');
    return '<div class="pathway-bottom-panel__cables">' +
      '<p class="pathway-bottom-panel__subhead">Cable Info</p>' +
      '<ul class="pathway-bottom-panel__cable-list">' + items + '</ul>' +
      '</div>';
  }

  function syncPathPanelTabs(pathType) {
    if (!panelEl) return;
    var tabsEl = panelEl.querySelector('.pathway-bottom-panel__tabs');
    if (!tabsEl) return;
    if (pathType === 'excavation') {
      tabsEl.innerHTML =
        '<button type="button" class="pathway-bottom-panel__tab pathway-bottom-panel__tab--active" data-tab="info" role="tab">Excavation</button>' +
        '<button type="button" class="pathway-bottom-panel__tab" data-tab="cables" role="tab">Cable Info</button>' +
        '<button type="button" class="pathway-bottom-panel__tab" data-tab="edit" role="tab">Edit Tools</button>';
    } else if (pathType === 'fiber') {
      tabsEl.innerHTML =
        '<button type="button" class="pathway-bottom-panel__tab pathway-bottom-panel__tab--active" data-tab="info" role="tab">Cable Features</button>' +
        '<button type="button" class="pathway-bottom-panel__tab" data-tab="edit" role="tab">Edit Tools</button>';
    } else {
      tabsEl.innerHTML =
        '<button type="button" class="pathway-bottom-panel__tab pathway-bottom-panel__tab--active" data-tab="info" role="tab">Path Info</button>' +
        '<button type="button" class="pathway-bottom-panel__tab" data-tab="edit" role="tab">Edit Tools</button>';
    }
    syncTabButtons();
  }

  function renderExcavationFeaturesBody(path, meta) {
    var burial = getExcavLabel(path.kind);
    var excavNo = b()?.getExcavationDisplayNumber?.(path) || path.id;
    return '<div class="pathway-bottom-panel__section">' +
      '<p class="pathway-bottom-panel__asbuilt-tag">AB_LM_Excavation</p>' +
      '<dl class="pathway-bottom-panel__dl">' +
        '<dt>Excavation No.</dt><dd class="font-mono text-fiber-cyan">' + escapeHtml(excavNo) + '</dd>' +
        '<dt>Burial Type</dt><dd>' + escapeHtml(burial) + '</dd>' +
        '<dt>Length</dt><dd><span class="font-mono">' + escapeHtml(meta.lengthM) + '</span> m</dd>' +
        '<dt>Vertices</dt><dd>' + (path.points?.length || 0) + '</dd>' +
        '<dt>Internal ID</dt><dd class="font-mono text-slate-400">' + escapeHtml(path.id) + '</dd>' +
      '</dl>' +
      '<button type="button" id="btn-delete-path" class="pathway-bottom-panel__btn pathway-bottom-panel__btn--danger" data-action="delete-path">' +
        '✕ Delete entire path' +
      '</button>' +
    '</div>';
  }

  function renderCableFeaturesBody(path, meta) {
    var asBuiltId = b()?.formatCableAsBuiltId?.(path) || path.name || '—';
    var kindLabel = path.kind === 'lastmile' ? 'Last Mile' : 'FTTH Main';
    var endpoints = (path.connectedTo?.start || '—') + ' → ' + (path.connectedTo?.end || '—');
    
    // Check for duplicate batch and update status bar
    var duplicateWarning = checkDuplicateBatch(path);
    updateStatusBarWithWarning(duplicateWarning);
    
    var batchHtml = '<dt>Batch</dt><dd class="font-mono">' + escapeHtml(String(path.batch || 1)) + '</dd>';
    if (duplicateWarning && duplicateWarning.isDuplicate) {
      batchHtml = '<dt>Batch</dt><dd class="font-mono" style="color: #ef4444; font-weight: bold;">' + escapeHtml(String(path.batch || 1)) + ' ⚠ DUPLICATE</dd>';
    }
    
    return '<div class="pathway-bottom-panel__section">' +
      '<p class="pathway-bottom-panel__asbuilt-tag">AB_LM_Cable</p>' +
      '<dl class="pathway-bottom-panel__dl">' +
        '<dt>Cable ID</dt><dd class="font-mono text-fiber-cyan">' + escapeHtml(asBuiltId) + '</dd>' +
        '<dt>Capacity</dt><dd class="font-mono">' + escapeHtml(String(path.capacity || '?') + 'F') + '</dd>' +
        batchHtml +
        '<dt>Cable Class</dt><dd>' + escapeHtml(kindLabel) + '</dd>' +
        '<dt>Length</dt><dd><span class="font-mono">' + escapeHtml(meta.lengthM) + '</span> m</dd>' +
        '<dt>Endpoints</dt><dd>' + escapeHtml(endpoints) + '</dd>' +
      '</dl>' +
      (path.trenchPathId
        ? '<p class="pathway-bottom-panel__hint">Hosted trench: <span class="font-mono">' + escapeHtml(path.trenchPathId) + '</span></p>'
        : '') +
      (duplicateWarning && duplicateWarning.isDuplicate
        ? '<p class="pathway-bottom-panel__hint" style="color: #ef4444; font-weight: bold;">⚠ تنبيه: هذه الدفعة مكررة أو مستخدمة مسبقاً! Batch ' + duplicateWarning.batch + ' مستخدم في: ' + duplicateWarning.otherCables.join(', ') + '</p>'
        : '') +
      '<button type="button" id="btn-delete-path" class="pathway-bottom-panel__btn pathway-bottom-panel__btn--danger" data-action="delete-path">' +
        '✕ Delete cable path' +
      '</button>' +
    '</div>';
  }



  function isVertexModeActive() {
    var S = sim();
    return !!(S?.pathEdit?.vertexToolActive || b()?.getActiveCanvasTool?.() === 'vertex');
  }

  function runVertexAction(action) {
    var editor = global.FTTHPathwayEditor;
    if (!editor) return;
    if (action === 'vtx-prev') editor.navigateVertex(-1);
    else if (action === 'vtx-next') editor.navigateVertex(1);
    else if (action === 'vtx-add') editor.addVertexAtSelection();
    else if (action === 'vtx-del') editor.deleteSelectedVertex();
  }

  function bindVertexControlDelegation() {
    var body = document.getElementById('pathway-modal-body');
    if (!body || body.dataset.vtxBound === '1') return;
    body.dataset.vtxBound = '1';
    body.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-action^="vtx-"]');
      if (!btn || btn.disabled) return;
      e.preventDefault();
      e.stopPropagation();
      runVertexAction(btn.getAttribute('data-action'));
    });
  }

  function syncTabButtons() {
    if (!panelEl) return;
    panelEl.querySelectorAll('.pathway-bottom-panel__tab').forEach(function (btn) {
      btn.classList.toggle('pathway-bottom-panel__tab--active', btn.getAttribute('data-tab') === activeTab);
    });
  }

  function bindPanelEvents() {

    if (listenersBound || !panelEl) return;

    listenersBound = true;

    bindVertexControlDelegation();

    panelEl.addEventListener('click', function (e) {

      e.stopPropagation();

      var tabBtn = e.target.closest('[data-tab]');

      if (tabBtn) {
        activeTab = tabBtn.getAttribute('data-tab') || 'info';
        syncTabButtons();
        renderBody();
        return;
      }

      if (e.target.closest('[data-action="close"]')) { handleClose(); return; }

      if (e.target.closest('[data-action="delete-path"]')) { confirmDelete(); return; }

      if (e.target.closest('[data-action="start-edit"]')) { startEditMode(true); return; }

      if (e.target.closest('[data-action="toggle-split"]')) { toggleSplitTool(); return; }

      if (e.target.closest('[data-action="toggle-vertex"]')) { toggleVertexTool(); return; }

      if (e.target.closest('[data-action^="vtx-"]')) {
        e.preventDefault();
        runVertexAction(e.target.closest('[data-action^="vtx-"]').getAttribute('data-action'));
        return;
      }

      if (e.target.closest('[data-action="exit-vertex"]')) { exitVertexTool(); return; }

    });



    var mapIsolateEvents = ['mousedown', 'mousemove', 'pointerdown', 'pointermove', 'touchstart', 'touchmove', 'input'];

    mapIsolateEvents.forEach(function (evt) {

      panelEl.addEventListener(evt, function (e) {

        if (e.target.closest('#pathway-corner-radius') || e.target.closest('.pathway-bottom-panel__radius')) {

          e.stopPropagation();

        }

      }, { passive: true });

    });



    panelEl.addEventListener('input', function (e) {

      if (e.target.matches('#pathway-corner-radius')) {

        e.stopPropagation();

        applyCornerRadius(parseInt(e.target.value, 10) || 0);

      }

    });



    panelEl.addEventListener('change', function (e) {

      if (e.target.matches('#pathway-corner-radius')) b()?.saveState?.();

    });

  }



  function ensurePanelDom() {

    b()?.ensureBottomPanelInWorkspace?.();

    if (!panelEl) panelEl = document.getElementById('pathway-properties-modal');

    if (panelEl && panelEl.parentElement !== getPanelHost()) mountPanelToHost();



    if (!panelEl) {

      panelEl = document.createElement('div');

      panelEl.id = 'pathway-properties-modal';

      panelEl.className = 'pathway-bottom-panel hidden';

      panelEl.setAttribute('role', 'region');

      panelEl.setAttribute('aria-label', 'Path Properties');

      panelEl.setAttribute('aria-hidden', 'true');

      panelEl.innerHTML =

        '<div class="pathway-bottom-panel__inner">' +

          '<header class="pathway-bottom-panel__header">' +

            '<div class="pathway-bottom-panel__drag-hint" aria-hidden="true"></div>' +

            '<h2 class="pathway-bottom-panel__title">Path Properties</h2>' +

            '<button type="button" class="pathway-bottom-panel__close" data-action="close" aria-label="Close">✕</button>' +

          '</header>' +

          '<nav class="pathway-bottom-panel__tabs" role="tablist">' +

            '<button type="button" class="pathway-bottom-panel__tab pathway-bottom-panel__tab--active" data-tab="info" role="tab">Path Info</button>' +

            '<button type="button" class="pathway-bottom-panel__tab" data-tab="edit" role="tab">Edit Tools</button>' +

          '</nav>' +

          '<div class="pathway-bottom-panel__body" id="pathway-modal-body"></div>' +

        '</div>';

      getPanelHost().appendChild(panelEl);

    }



    mountPanelToHost();

    bindPanelEvents();
    bindVertexControlDelegation();

    return panelEl;

  }



  function renderVertexBody() {
    return '';
  }

  function ensurePanelVisibleForVertexTool() {
    if (!panelEl) return;
    panelEl.classList.remove('hidden');
    panelEl.classList.add('is-expanded', 'active');
    panelEl.style.display = 'flex';
    panelEl.setAttribute('aria-hidden', 'false');
    b()?.syncPathBottomPanelLayout?.(true);
    renderBody();
  }

  function renderBody() {

    var body = document.getElementById('pathway-modal-body');

    var S = sim();

    if (!body || !S?.selectedPath) return;

    var meta = getPathMeta(S.selectedPath);

    if (!meta) {

      body.innerHTML = '<p class="pathway-bottom-panel__empty">Path not found.</p>';

      return;

    }

    var path = meta.path;

    var editActive = !!S.pathEdit?.editActive;

    var splitActive = !!S.pathEdit?.splitToolActive;
    var vertexActive = !!(S.pathEdit?.vertexToolActive || b()?.getActiveCanvasTool?.() === 'vertex');
    var vtx = S.pathEdit?.selectedVertexIndex;

    var titleEl = panelEl?.querySelector('.pathway-bottom-panel__title');
    var tabsEl = panelEl?.querySelector('.pathway-bottom-panel__tabs');
    syncPathPanelTabs(S.selectedPath.type);
    if (titleEl) {
      if (S.selectedPath.type === 'excavation') titleEl.textContent = 'Excavation Features';
      else if (S.selectedPath.type === 'fiber') titleEl.textContent = 'Cable Features';
      else titleEl.textContent = 'Path Properties';
    }
    if (tabsEl) tabsEl.style.display = '';
    var closeBtn = panelEl?.querySelector('[data-action="close"]');
    if (closeBtn) {
      closeBtn.setAttribute('aria-label', vertexActive ? 'Exit vertex tool' : 'Close panel');
      closeBtn.title = vertexActive ? 'Exit vertex tool' : 'Close panel';
    }

    syncTabButtons();

    if (activeTab === 'info') {

      var vertexHint = vertexActive
        ? '<p class="pathway-bottom-panel__hint">◇ Vertex Tool active — drag points on map · double-click path to add vertex.</p>'
        : '';

      if (S.selectedPath.type === 'excavation') {
        body.innerHTML = renderExcavationFeaturesBody(path, meta) + vertexHint;
      } else if (S.selectedPath.type === 'fiber') {
        body.innerHTML = renderCableFeaturesBody(path, meta) + vertexHint;
      } else {
        body.innerHTML =
          '<div class="pathway-bottom-panel__section">' +
            '<dl class="pathway-bottom-panel__dl">' +
              '<dt>Path ID</dt><dd class="font-mono text-fiber-cyan">' + escapeHtml(path.id) + '</dd>' +
              '<dt>Type</dt><dd>' + escapeHtml(meta.typeLabel) + '</dd>' +
              '<dt>Length</dt><dd><span class="font-mono">' + escapeHtml(meta.lengthM) + '</span> m</dd>' +
              '<dt>Vertices</dt><dd>' + (path.points?.length || 0) + '</dd>' +
            '</dl>' + vertexHint +
            '<button type="button" id="btn-delete-path" class="pathway-bottom-panel__btn pathway-bottom-panel__btn--danger" data-action="delete-path">' +
              '✕ Delete entire path' +
            '</button>' +
          '</div>';
      }

    } else if (activeTab === 'cables' && S.selectedPath.type === 'excavation') {

      body.innerHTML =
        '<div class="pathway-bottom-panel__section">' +
          '<p class="pathway-bottom-panel__asbuilt-tag">AB_LM_Excavation · Cable Info</p>' +
          renderTrenchCablesSection(path.id) +
        '</div>';

    } else {

      body.innerHTML =

        '<div class="pathway-bottom-panel__section pathway-bottom-panel__section--edit">' +

          '<div class="pathway-bottom-panel__tools-row">' +

            '<button type="button" class="pathway-bottom-panel__btn' + (editActive ? ' pathway-bottom-panel__btn--active' : '') +

              '" data-action="start-edit">✏ Edit path' + (editActive ? ' (active)' : '') + '</button>' +

            '<button type="button" class="pathway-bottom-panel__btn' + (splitActive ? ' pathway-bottom-panel__btn--active' : '') +

              '" data-action="toggle-split">✂ Cut' + (splitActive ? ' (on)' : '') + '</button>' +

            '<button type="button" class="pathway-bottom-panel__btn' + (vertexActive ? ' pathway-bottom-panel__btn--active' : '') +

              '" data-action="toggle-vertex">◇ Vertex Tool' + (vertexActive ? ' (on)' : '') + '</button>' +

          '</div>' +

          '<p class="pathway-bottom-panel__hint">Vertex Tool: drag points on map. Cut: swipe or click segment on map.</p>' +

          (editActive

            ? '<div class="pathway-bottom-panel__radius">' +

                '<label for="pathway-corner-radius">Corner radius (vertex ' + (vtx != null ? vtx : '—') + ')</label>' +

                '<input type="range" id="pathway-corner-radius" min="0" max="50" step="1" value="' +

                (path.cornerRadii?.[vtx] || path.cornerRadii?.[String(vtx)] || 0) + '">' +

                '<span id="pathway-radius-val">' + (path.cornerRadii?.[vtx] || 0) + ' px</span>' +

              '</div>'

            : '<p class="pathway-bottom-panel__hint pathway-bottom-panel__hint--muted">Tap Edit path, then select a vertex on the map.</p>') +

        '</div>';

    }

  }



  function open(pathType, pathId) {

    ensurePanelDom();

    if (!panelEl) return;

    var wasHidden = panelEl.classList.contains('hidden');
    if (wasHidden) activeTab = 'info';

    syncTabButtons();

    panelEl.classList.remove('hidden');

    panelEl.classList.add('is-expanded', 'active');

    panelEl.style.display = 'flex';

    panelEl.setAttribute('aria-hidden', 'false');

    syncPanelLayout(true);

    renderBody();

  }



  function handleClose() {
    if (isVertexModeActive()) {
      exitVertexTool();
      return;
    }
    closePanelOnly();
  }

  function closePanelOnlyFast() {
    if (!panelEl) return;
    var titleEl = panelEl.querySelector('.pathway-bottom-panel__title');
    var tabsEl = panelEl.querySelector('.pathway-bottom-panel__tabs');
    if (titleEl) titleEl.textContent = 'Path Properties';
    if (tabsEl) tabsEl.style.display = '';
    panelEl.classList.add('hidden');
    panelEl.classList.remove('is-expanded', 'active');
    panelEl.style.display = '';
    panelEl.setAttribute('aria-hidden', 'true');
    syncPanelLayout(false);
  }

  function closePanelOnly() {

    var S = sim();

    if (S?.pathEdit) {

      S.pathEdit.editActive = false;

      S.pathEdit.splitToolActive = false;

      S.pathEdit.vertexToolActive = false;
      S.pathEdit.cutHover = null;

      S.pathEdit.cutSwipe = null;

      S.pathEdit.editingPathId = null;

      S.pathEdit.isDraggingVertex = false;

      S.pathEdit.drag = null;
      S.pathEdit.ghostPosition = null;
      S.pathEdit.ghostActive = false;
      S.pathEdit.ghostDragging = false;
      S.pathEdit.ghostSnapped = false;
      S.pathEdit.frozenPoints = null;
      S.pathEdit.frozenPathD = null;

    }

    b()?.setPathEditActive?.(false);

    b()?.setActiveCanvasTool?.('select');

    b()?.syncDrawingLayerInteraction?.();

    b()?.renderGlobalDrawingLayer?.();

    clearStatusBarWarning();

    if (!panelEl) return;

    var titleEl = panelEl.querySelector('.pathway-bottom-panel__title');
    var tabsEl = panelEl.querySelector('.pathway-bottom-panel__tabs');
    if (titleEl) titleEl.textContent = 'Path Properties';
    if (tabsEl) tabsEl.style.display = '';

    panelEl.classList.add('hidden');

    panelEl.classList.remove('is-expanded', 'active');

    panelEl.style.display = '';

    panelEl.setAttribute('aria-hidden', 'true');

    syncPanelLayout(false);

  }



  function close() { closePanelOnly(); }



  function refresh() {

    if (!panelEl || panelEl.classList.contains('hidden')) return;

    renderBody();

    if (!getPathMeta(sim()?.selectedPath)) close();

  }



  function confirmDelete() {
    var ref = sim()?.selectedPath;
    if (!ref || !getPathMeta(ref)?.path) return;
    if (b()?.deleteSelectedPath) b().deleteSelectedPath();
    else if (b()?.onDeletePathway) b().onDeletePathway(ref.type, ref.id);
  }



  function startEditMode(switchTab) {

    var S = sim();

    if (!S?.selectedPath) return;

    var ref = S.selectedPath;

    if (b()?.setPathEditActive) b().setPathEditActive(true, ref.type, ref.id);

    else {

      if (!S.pathEdit) S.pathEdit = { drag: null, context: null };

      S.pathEdit.editActive = true;

      S.pathEdit.editingPathId = { type: ref.type, id: ref.id };

      S.pathEdit.splitToolActive = false;

      S.pathEdit.vertexToolActive = false;

      b()?.syncDrawingLayerInteraction?.();

      b()?.renderGlobalDrawingLayer?.();

    }

    b()?.setEditingPathwayId?.(ref.type, ref.id);

    if (switchTab !== false) {
      activeTab = 'edit';
      syncTabButtons();
    }

    b()?.updateStatus?.('Edit mode — map + panel both active');

    renderBody();

  }



  function toggleSplitTool() {

    var S = sim();

    if (!S?.selectedPath) return;

    var ref = S.selectedPath;

    var nextActive = !S.pathEdit?.splitToolActive;

    if (b()?.setActiveTool) b().setActiveTool(nextActive ? 'split' : null);

    else {

      if (!S.pathEdit) S.pathEdit = { drag: null, context: null };

      S.pathEdit.splitToolActive = nextActive;

      if (nextActive) {

        S.pathEdit.editActive = true;

        S.pathEdit.editingPathId = { type: ref.type, id: ref.id };

      }

      b()?.syncDrawingLayerInteraction?.();

      b()?.renderGlobalDrawingLayer?.();

    }

    if (nextActive) {

      b()?.setPathEditActive?.(true, ref.type, ref.id);

      b()?.setEditingPathwayId?.(ref.type, ref.id);

    }

    activeTab = 'edit';

    syncTabButtons();

    renderBody();

    b()?.updateStatus?.(nextActive ? 'Cut — click vertex or segment on map' : 'Cut tool off');

    if (nextActive && S.pathEdit) S.pathEdit.vertexToolActive = false;

  }



  function exitVertexTool() {
    b()?.setActiveCanvasTool?.('select');
    activeTab = 'edit';
    renderBody();
  }

  function toggleVertexTool() {
    var S = sim();
    if (!S?.selectedPath) return;
    var turningOn = !(S.pathEdit?.vertexToolActive || b()?.getActiveCanvasTool?.() === 'vertex');
    if (turningOn) {
      if (S.pathEdit) S.pathEdit.splitToolActive = false;
      b()?.setActiveCanvasTool?.('vertex');
      ensurePanelVisibleForVertexTool();
    } else {
      exitVertexTool();
    }
  }



  function applyCornerRadius(radius) {

    var S = sim();

    var ref = S?.selectedPath;

    var idx = S?.pathEdit?.selectedVertexIndex;

    if (!ref || idx == null) return;

    if (b()?.onUpdateCurve) b().onUpdateCurve(ref.type, ref.id, idx, radius);

    else global.FTTHPathwayEditor?.setCornerRadius?.(ref.type, ref.id, idx, radius);

    var valEl = document.getElementById('pathway-radius-val');

    if (valEl) valEl.textContent = radius + ' px';

  }



  global.PathwayPropertiesModal = {

    init: function (deps) {
      bridge = deps;
    },

    open: function () {
      b()?.renderUnifiedSidebar?.();
    },

    close: function () {
      b()?.renderUnifiedSidebar?.();
    },

    closePanelOnlyFast: function () {},

    refresh: function () {
      b()?.renderUnifiedSidebar?.();
    },

    ensurePanelVisibleForVertexTool: function () {
      b()?.renderUnifiedSidebar?.();
    },

    ensureMounted: function () {},

    clearDuplicationWarning: clearDuplicationWarning,
    onPathMerged: onPathMerged,

  };

})(window);


