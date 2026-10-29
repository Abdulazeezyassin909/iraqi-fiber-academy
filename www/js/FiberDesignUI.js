/**
 * FTTH Fiber Design UI — Stage 4.
 * Sidebar tabs + Floating Matrix Viewer (read-only).
 * Renders AutoFiberEngine output only. No splice mutation.
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var deps = null;
  /** @type {Object<string, string>} active cable tab id per node */
  var activeCableTabByNode = Object.create(null);
  var stylesInjected = false;

  /* Floating matrix state */
  var matrixEl = null;
  var matrixOpen = false;
  var matrixEventsBound = false;
  var activeMatrixTab = 'distribution'; // distribution | ring
  var activeCabinetFilter = 'all';

  function resolveActiveFdtFilterId() {
    try {
      if (global.FTTHActiveFdt && typeof global.FTTHActiveFdt.getActiveFdtId === 'function') {
        return global.FTTHActiveFdt.getActiveFdtId();
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function applyActiveFdtMatrixFilter(fdtId) {
    if (fdtId) activeCabinetFilter = String(fdtId);
    if (matrixEl && !matrixEl.classList.contains('hidden')) {
      refreshMatrix();
    }
  }
  var activeClosureFilter = 'all';
  var activeSortMode = 'cindex'; // insertion, chronological, cindex
  var dragState = null;
  var resizeState = null;
  var colResizeState = null;
  var MIN_WIN_W = 360;
  var MIN_WIN_H = 220;
  var MIN_COL_W = 48;
  /** @type {Object<string, Object<string, number>>} persisted col widths per matrix tab */
  var matrixColumnWidths = {
    distribution: Object.create(null),
    ring: Object.create(null),
  };
  var COL_WIDTHS_STORAGE_KEY = 'ifa_fd_matrix_col_widths';

  var MATRIX_COLUMNS = [
    { key: 'splitter_fiber_no', label: 'Splitter Fiber No.' },
    { key: 'pigtails_fiber_color', label: 'Pigtails (fiber color)', colorCell: true },
    { key: 'm_cable_id', label: 'M-Cable ID' },
    { key: 'm_tube_color', label: 'Cable tube color', colorCell: true },
    { key: 'm_fiber_color', label: 'Cable (Fiber color)', colorCell: true },
    { key: 'closure_id', label: 'HH-Closure_ID' },
    { key: 's_cable_id', label: 'S-Cable ID' },
    { key: 's_tube_color', label: 'S-Cable Tube color', colorCell: true },
    { key: 's_fiber_color', label: 'FAT Cable (Fiber color)', colorCell: true },
    { key: 'fiber_type', label: 'Fiber Type' },
    { key: 'fat_id', label: 'FAT ID / Pole ID' },
    { key: 'design_path', label: 'Design Path' },
  ];

  var RING_MATRIX_COLUMNS = [
    { key: 'feeder_cable_id', label: 'CABLE ID' },
    { key: 'cable_layer', label: 'Cable Layer' },
    { key: 'tube_label', label: 'TUBE Colour', tubeCell: true },
    { key: 'cabinet_id', label: 'FDT_ID' },
    { key: 'splice_tray', label: 'Splice Tray' },
    { key: 'fiber_label', label: 'Tray Fiber Color', fiberCell: true },
    { key: 'pigtail_no', label: 'Pigtail_No' },
    { key: 'spliter', label: 'Spliter' },
    { key: 'splitter_port', label: 'Splitter Port' },
  ];

  var ROWSPAN_GROUP_KEYS = [
    'm_cable_id',
    'm_tube_color',
    'closure_id',
    's_cable_id',
    's_tube_color',
    'fat_id',
    'design_path',
  ];

  /* ring_block_id isolates Main vs Backup so shared cells span only within each 12-row unit */
  var RING_ROWSPAN_GROUP_KEYS = [
    'ring_block_id',
    'feeder_cable_id',
    'cable_layer',
    'tube_label',
    'cabinet_id',
    'splice_tray',
    'splitter_port',
  ];

  var FIBER_COLOR_CSS = {
    blue: '#2563eb',
    orange: '#ea580c',
    green: '#16a34a',
    brown: '#92400e',
    slate: '#64748b',
    grey: '#64748b',
    gray: '#64748b',
    white: '#f8fafc',
    red: '#dc2626',
    black: '#1e293b',
    yellow: '#eab308',
    violet: '#7c3aed',
    rose: '#e11d48',
    pink: '#e11d48',
    aqua: '#06b6d4',
    cyan: '#06b6d4',
  };

  function loadColumnWidths() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(COL_WIDTHS_STORAGE_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      ['distribution', 'ring'].forEach(function (tab) {
        if (!parsed[tab] || typeof parsed[tab] !== 'object') return;
        matrixColumnWidths[tab] = Object.create(null);
        Object.keys(parsed[tab]).forEach(function (key) {
          var n = Number(parsed[tab][key]);
          if (n >= MIN_COL_W && isFinite(n)) matrixColumnWidths[tab][key] = Math.round(n);
        });
      });
    } catch (e) { /* ignore */ }
  }

  function persistColumnWidths() {
    try {
      if (global.localStorage) {
        global.localStorage.setItem(COL_WIDTHS_STORAGE_KEY, JSON.stringify({
          distribution: matrixColumnWidths.distribution || {},
          ring: matrixColumnWidths.ring || {},
        }));
      }
    } catch (e) { /* ignore */ }
  }

  function getColumnWidthMap(tabId) {
    var tab = tabId || activeMatrixTab || 'distribution';
    if (!matrixColumnWidths[tab]) matrixColumnWidths[tab] = Object.create(null);
    return matrixColumnWidths[tab];
  }

  function init(api) {
    deps = Object.assign({}, deps || {}, api || {});
    loadColumnWidths();
    ensureStyles();
  }

  function getManager() {
    return deps.getFiberDesignManager
      ? deps.getFiberDesignManager()
      : (global.FTTHFiberDesignManager || null);
  }

  function getOverlayHost() {
    if (deps && typeof deps.getOverlayHost === 'function') {
      var host = deps.getOverlayHost();
      if (host) return host;
    }
    return document.getElementById('sim-workspace-overlays') ||
      document.getElementById('canvas-main') ||
      document.getElementById('simulator-container');
  }

  function escapeHtml(text) {
    return String(text == null ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(text) {
    return escapeHtml(text).replace(/'/g, '&#39;');
  }

  function parseCableLabelSortKey(label) {
    var raw = String(label || '').trim();
    var m = raw.match(/^(\d+)F(\d+)?/i);
    if (!m) {
      return { capacity: 0, batch: 9999, label: raw.toLowerCase() };
    }
    return {
      capacity: parseInt(m[1], 10) || 0,
      batch: parseInt(m[2] || '1', 10) || 1,
      label: raw.toLowerCase(),
    };
  }

  function cableTabLabel(cable) {
    if (!cable) return '—';
    if (cable.name && String(cable.name).trim()) return String(cable.name).trim();
    return 'Cable';
  }

  function sortCablesForTabs(cables) {
    /* Preserve physical connection / insertion order — no ascending label sort. */
    return (cables || []).slice();
  }

  /**
   * Sidebar Fiber Design inspection: show cables for the selected node freely.
   * Do NOT filter by locked Active FDT — matrix viewer keeps that domain filter.
   */
  function collectNodeCables(nodeData) {
    if (!nodeData || !nodeData.cables) return [];
    var inbound = Array.isArray(nodeData.cables.inbound) ? nodeData.cables.inbound : [];
    var outbound = Array.isArray(nodeData.cables.outbound) ? nodeData.cables.outbound : [];
    return inbound.concat(outbound).filter(Boolean);
  }

  function hasFiberDesignContent(nodeData) {
    if (!nodeData) return false;
    var cables = collectNodeCables(nodeData);
    return cables.length > 0;
  }

  function getActiveCableId(nodeId, cables) {
    var id = nodeId != null ? String(nodeId) : '';
    var activeId = id ? activeCableTabByNode[id] : null;
    if (activeId && cables.some(function (c) { return c && String(c.id) === String(activeId); })) {
      return String(activeId);
    }
    return cables.length ? String(cables[0].id) : null;
  }

  function renderFiberRow(fiber) {
    if (!fiber) return '';
    var status = fiber.status || 'available';
    return '<li class="fiber-design-fiber">' +
      '<span class="fiber-design-fiber__num">' + escapeHtml(fiber.fiber_number) + '</span>' +
      '<span class="fiber-design-fiber__color">' + escapeHtml(fiber.fiber_color || '—') + '</span>' +
      '<span class="fiber-design-fiber__status fiber-design-fiber__status--' +
      escapeAttr(status) + '">' + escapeHtml(status) + '</span>' +
      '</li>';
  }

  function renderTubeBlock(tube) {
    if (!tube) return '';
    var fibers = Array.isArray(tube.fibers) ? tube.fibers : [];
    var fiberHtml = fibers.length
      ? fibers.map(renderFiberRow).join('')
      : '<li class="fiber-design-fiber fiber-design-fiber--empty">No fibers</li>';
    return '<li class="fiber-design-tube">' +
      '<div class="fiber-design-tube__head">' +
      '<span class="fiber-design-tube__num">Tube ' + escapeHtml(tube.tube_number) + '</span>' +
      '<span class="fiber-design-tube__color">' + escapeHtml(tube.tube_color || '—') + '</span>' +
      '</div>' +
      '<ul class="fiber-design-fibers">' + fiberHtml + '</ul>' +
      '</li>';
  }

  function renderCableDetail(cable) {
    if (!cable) {
      return '<p class="fiber-design-panel__empty">No Fiber Design Available</p>';
    }
    var tubes = Array.isArray(cable.tubes) ? cable.tubes : [];
    if (!tubes.length) {
      return '<p class="fiber-design-panel__hint">No tubes defined for this cable.</p>';
    }
    var tubeHtml = tubes.map(renderTubeBlock).join('');
    var dir = cable.direction === 'outbound' ? 'Outbound' : 'Inbound';
    return '<div class="fiber-design-cable-detail">' +
      '<p class="fiber-design-cable-detail__meta">' +
      '<span class="fiber-design-cable-detail__dir">' + escapeHtml(dir) + '</span>' +
      (cable.name ? '<span class="fiber-design-cable-detail__name">' + escapeHtml(cable.name) + '</span>' : '') +
      '</p>' +
      '<ul class="fiber-design-tubes">' + tubeHtml + '</ul>' +
      '</div>';
  }

  function renderTabs(nodeId, cables, activeCableId) {
    if (!cables.length) return '';
    var tabsHtml = cables.map(function (cable) {
      var label = cableTabLabel(cable);
      var isActive = String(cable.id) === String(activeCableId);
      return '<button type="button" class="fiber-design-tab' + (isActive ? ' fiber-design-tab--active' : '') +
        '" role="tab" aria-selected="' + (isActive ? 'true' : 'false') + '" data-fiber-design-tab="1" ' +
        'data-node-id="' + escapeAttr(nodeId) + '" data-cable-id="' + escapeAttr(cable.id) + '">' +
        escapeHtml(label) + '</button>';
    }).join('');
    return '<div class="fiber-design-tabs" role="tablist">' + tabsHtml + '</div>';
  }

  function renderPanelBody(nodeId, nodeData) {
    if (!hasFiberDesignContent(nodeData)) {
      return '<div class="fiber-design-panel fiber-design-panel--empty">' +
        '<p class="fiber-design-panel__empty">No Fiber Design Available</p>' +
        '</div>';
    }

    var cables = sortCablesForTabs(collectNodeCables(nodeData));
    var activeCableId = getActiveCableId(nodeId, cables);
    var activeCable = null;
    var i;
    for (i = 0; i < cables.length; i++) {
      if (String(cables[i].id) === String(activeCableId)) {
        activeCable = cables[i];
        break;
      }
    }

    return '<div class="fiber-design-panel" data-fiber-design-node="' + escapeAttr(nodeId) + '">' +
      renderTabs(nodeId, cables, activeCableId) +
      '<div class="fiber-design-tab-content" role="tabpanel">' +
      renderCableDetail(activeCable) +
      '</div>' +
      '</div>';
  }

  function renderSection(nodeId) {
    var id = nodeId != null ? String(nodeId) : '';
    if (!id) {
      return '<section class="sidebar-section sidebar-section--fiber-design">' +
        '<h3 class="sidebar-section__title">Fiber Design</h3>' +
        '<div class="fiber-design-panel fiber-design-panel--empty">' +
        '<p class="fiber-design-panel__empty">No Fiber Design Available</p>' +
        '</div></section>';
    }

    var mgr = getManager();
    if (mgr && mgr.ensureDisplayData) mgr.ensureDisplayData();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(id) : null;

    return '<section class="sidebar-section sidebar-section--fiber-design" id="fiber-design-sidebar-section">' +
      '<h3 class="sidebar-section__title">Fiber Design</h3>' +
      renderPanelBody(id, nodeData) +
      '</section>';
  }

  function refreshPanelContent(container, nodeId) {
    if (!container) return;
    var section = container.querySelector('#fiber-design-sidebar-section') ||
      container.querySelector('.sidebar-section--fiber-design');
    if (!section) return;
    var mgr = getManager();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
    var inner = section.querySelector('.fiber-design-panel') ||
      section.querySelector('.fiber-design-panel--empty');
    if (!inner) {
      var title = section.querySelector('.sidebar-section__title');
      var wrap = document.createElement('div');
      wrap.innerHTML = renderPanelBody(nodeId, nodeData);
      var newPanel = wrap.firstElementChild;
      if (title && title.nextSibling) {
        section.replaceChild(newPanel, title.nextSibling);
      } else {
        section.appendChild(newPanel);
      }
      return;
    }
    var wrap2 = document.createElement('div');
    wrap2.innerHTML = renderPanelBody(nodeId, nodeData);
    var newBody = wrap2.firstElementChild;
    if (newBody) inner.replaceWith(newBody);
  }

  function onTabClick(btn) {
    if (!btn) return;
    var nodeId = btn.getAttribute('data-node-id');
    var cableId = btn.getAttribute('data-cable-id');
    if (!nodeId || !cableId) return;
    activeCableTabByNode[String(nodeId)] = String(cableId);

    var panel = btn.closest('.fiber-design-panel');
    if (!panel) return;
    var tabs = panel.querySelectorAll('[data-fiber-design-tab]');
    var i;
    for (i = 0; i < tabs.length; i++) {
      var active = tabs[i] === btn;
      tabs[i].classList.toggle('fiber-design-tab--active', active);
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }

    var mgr = getManager();
    var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
    if (!nodeData) return;
    var cables = sortCablesForTabs(collectNodeCables(nodeData));
    var activeCable = null;
    for (i = 0; i < cables.length; i++) {
      if (String(cables[i].id) === String(cableId)) {
        activeCable = cables[i];
        break;
      }
    }
    var content = panel.querySelector('.fiber-design-tab-content');
    if (content) content.innerHTML = renderCableDetail(activeCable);
  }

  function bind(container, nodeId) {
    if (!container) return;
    container.querySelectorAll('[data-fiber-design-tab]').forEach(function (btn) {
      if (btn._fiberDesignBound) return;
      btn._fiberDesignBound = true;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        onTabClick(btn);
      });
    });
    if (nodeId != null && !activeCableTabByNode[String(nodeId)]) {
      var mgr = getManager();
      var nodeData = mgr && mgr.getNodeData ? mgr.getNodeData(nodeId) : null;
      if (hasFiberDesignContent(nodeData)) {
        var cables = sortCablesForTabs(collectNodeCables(nodeData));
        if (cables.length) activeCableTabByNode[String(nodeId)] = String(cables[0].id);
      }
    }
  }

  function clearActiveTab(nodeId) {
    if (nodeId == null) return;
    delete activeCableTabByNode[String(nodeId)];
  }

  /* ═══════════════ Floating Matrix Viewer ═══════════════ */

  function isBlankMatrixValue(val) {
    if (val == null) return true;
    var s = String(val).trim();
    if (!s) return true;
    if (s === '—' || s === '–' || s === '-') return true;
    var lower = s.toLowerCase();
    return lower === 'null' || lower === 'undefined' || lower === 'n/a';
  }

  /** Direct Cabinet→Pole rows (no HH-Closure / S-Cable) — always sort to matrix bottom. */
  function isDirectNoClosureRow(row) {
    if (!row) return false;
    if (row.direct_cabinet_pole) return true;
    if (String(row.path_source || '') === 'interactive_trail_direct') return true;
    return false;
  }

  function compareDirectRowsLast(a, b) {
    var ad = isDirectNoClosureRow(a) ? 1 : 0;
    var bd = isDirectNoClosureRow(b) ? 1 : 0;
    return ad - bd;
  }

  function fiberColorStyle(colorName, striped) {
    if (isBlankMatrixValue(colorName)) {
      /* Empty sub-cable / unused color cells: no tint — match plain dark empty cells */
      return '';
    }
    var key = String(colorName || '').trim().toLowerCase();
    var bg = FIBER_COLOR_CSS[key];
    if (!bg) {
      /* Unknown non-blank token still blank-styled rather than slate fill */
      return '';
    }
    var fg = (key === 'white' || key === 'yellow') ? '#0f172a' : '#f8fafc';
    var style = 'background-color:' + bg + ';color:' + fg + ';';
    if (striped) {
      style +=
        'background-image:repeating-linear-gradient(135deg,rgba(0,0,0,0.55) 0 3px,transparent 3px 7px);';
    }
    return style;
  }

  function groupKeyForRow(row, fields) {
    var parts = [];
    var i;
    for (i = 0; i < fields.length; i++) {
      parts.push(String(row[fields[i]] != null ? row[fields[i]] : ''));
    }
    return parts.join('\u0001');
  }

  function applyRowspanMetadata(rows, groupKeys) {
    if (!rows || !rows.length) return rows;
    var keys = groupKeys && groupKeys.length ? groupKeys : ROWSPAN_GROUP_KEYS;
    var r;
    var col;
    for (col = 0; col < keys.length; col++) {
      var field = keys[col];
      // CRITICAL FIX: closure_id and s_cable_id must merge independently of parent fields
      var parentFields = (field === 'closure_id' || field === 's_cable_id') ? [field] : keys.slice(0, col + 1);
      var i = 0;
      while (i < rows.length) {
        var baseKey = groupKeyForRow(rows[i], parentFields);
        var span = 1;
        while (i + span < rows.length &&
          groupKeyForRow(rows[i + span], parentFields) === baseKey) {
          span++;
        }
        rows[i]['_rs_' + field] = span;
        for (r = 1; r < span; r++) {
          rows[i + r]['_skip_' + field] = true;
        }
        i += span;
      }
    }
    return rows;
  }

  function renderCabinetFilterOptions() {
    var mgr = getManager();
    var cabinets = [];
    if (mgr && mgr.AutoFiberEngine && mgr.AutoFiberEngine.getCabinetRegistry) {
      cabinets = mgr.AutoFiberEngine.getCabinetRegistry() || [];
    } else if (mgr && mgr.getCabinetRegistry) {
      cabinets = mgr.getCabinetRegistry() || [];
    }
    var html = '<option value="all">All Cabinets</option>';
    cabinets.forEach(function (c) {
      var id = String(c.cabinet_id || c.node_id);
      html += '<option value="' + escapeAttr(id) + '"' +
        (activeCabinetFilter === id ? ' selected' : '') + '>' +
        escapeHtml(c.cabinet_label || id) + '</option>';
    });
    return html;
  }

  function renderClosureFilterOptions() {
    var mgr = getManager();
    var closures = [];
    if (mgr && mgr.AutoFiberEngine && mgr.AutoFiberEngine.getClosuresForCabinet) {
      closures = mgr.AutoFiberEngine.getClosuresForCabinet(activeCabinetFilter) || [];
    } else if (mgr && mgr.getClosureRegistry) {
      closures = mgr.getClosureRegistry() || [];
      if (activeCabinetFilter !== 'all') {
        closures = closures.filter(function (c) {
          return String(c.cabinet_id) === activeCabinetFilter;
        });
      }
    }
    if (activeClosureFilter !== 'all') {
      var stillValid = closures.some(function (c) {
        return String(c.node_id) === activeClosureFilter;
      });
      if (!stillValid) activeClosureFilter = 'all';
    }
    var html = '<option value="all">All Closures</option>';
    closures.forEach(function (c) {
      var id = String(c.node_id);
      html += '<option value="' + escapeAttr(id) + '"' +
        (activeClosureFilter === id ? ' selected' : '') + '>' +
        escapeHtml(c.closure_id) + '</option>';
    });
    return html;
  }

  function renderColGroup(columns) {
    var widths = getColumnWidthMap();
    return '<colgroup>' + columns.map(function (col) {
      var w = widths[col.key];
      return '<col data-col-key="' + escapeAttr(col.key) + '"' +
        (w ? ' style="width:' + w + 'px"' : '') + '>';
    }).join('') + '</colgroup>';
  }

  function renderMatrixTable(rows, options) {
    options = options || {};
    var columns = options.columns || MATRIX_COLUMNS;
    var rowspanKeys = options.rowspanKeys || ROWSPAN_GROUP_KEYS;
    var widths = getColumnWidthMap();
    // Always render table headers, even with no data
    var head = columns.map(function (col) {
      var w = widths[col.key];
      var thStyle = w ? ('width:' + w + 'px;min-width:' + w + 'px') : '';
      return '<th scope="col" data-col-key="' + escapeAttr(col.key) + '"' +
        (thStyle ? ' style="' + thStyle + '"' : '') + '>' +
        '<span class="fd-matrix-th__label">' + escapeHtml(col.label) + '</span>' +
        '<span class="fd-matrix-col-resizer" data-col-resize="' + escapeAttr(col.key) +
        '" role="separator" aria-orientation="vertical" title="Drag to resize column"></span>' +
        '</th>';
    }).join('');

    var body = '';
    if (rows && rows.length) {
      var annotated = applyRowspanMetadata(rows.slice(), rowspanKeys);
      body = annotated.map(function (row) {
        var cells = columns.map(function (col) {
          if (row['_skip_' + col.key]) return '';
          var rawVal = row[col.key];
          var val = !isBlankMatrixValue(rawVal) ? String(rawVal) : '';
          if (col.key === 'fat_id' && val) {
            var num = val.match(/(\d+)/);
            val = num ? num[1] : val;
          }
          var rs = row['_rs_' + col.key] || 1;
          var cls = 'fd-matrix-cell';
          var style = '';
          if (col.colorCell) {
            if (isBlankMatrixValue(rawVal)) {
              cls += ' fd-matrix-cell--empty-color';
              style = '';
              val = '';
            } else {
              cls += ' fd-matrix-cell--color';
              style = fiberColorStyle(val);
            }
          }
          if (col.tubeCell) {
            var tubeSrc = row.tube_color || rawVal;
            if (isBlankMatrixValue(tubeSrc)) {
              cls += ' fd-matrix-cell--empty-color';
              style = '';
              val = '';
            } else {
              cls += ' fd-matrix-cell--color fd-matrix-cell--tube';
              if (row.tube_striped) cls += ' fd-matrix-cell--striped';
              style = fiberColorStyle(tubeSrc, !!row.tube_striped);
            }
          }
          if (col.fiberCell) {
            var fiberSrc = row.fiber_color || rawVal;
            if (isBlankMatrixValue(fiberSrc)) {
              cls += ' fd-matrix-cell--empty-color';
              style = '';
              val = '';
            } else {
              cls += ' fd-matrix-cell--color fd-matrix-cell--fiber';
              style = fiberColorStyle(fiberSrc);
            }
          }
          if (col.key === 'fiber_type') {
            cls += ' fd-matrix-cell--type-' + escapeAttr(val.toLowerCase());
          }
          return '<td class="' + cls + '" rowspan="' + rs + '"' +
            (style ? ' style="' + style + '"' : '') + '>' +
            escapeHtml(val) + '</td>';
        }).join('');
        return '<tr>' + cells + '</tr>';
      }).join('');
    } else {
      body = '<tr><td class="fd-matrix-empty" colspan="' + columns.length + '">' +
        escapeHtml(options.emptyText || 'No splice rows for the current filters.') +
        '</td></tr>';
    }

    return '<div class="fd-matrix-scroll">' +
      '<table class="fd-matrix-table" cellspacing="0" cellpadding="0">' +
      renderColGroup(columns) +
      '<thead><tr>' + head + '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
      '</table></div>';
  }

  function findColByKey(table, key) {
    if (!table || !key) return null;
    var cols = table.querySelectorAll('col[data-col-key]');
    var i;
    for (i = 0; i < cols.length; i++) {
      if (cols[i].getAttribute('data-col-key') === key) return cols[i];
    }
    return null;
  }

  function findThByKey(table, key) {
    if (!table || !key) return null;
    var ths = table.querySelectorAll('th[data-col-key]');
    var i;
    for (i = 0; i < ths.length; i++) {
      if (ths[i].getAttribute('data-col-key') === key) return ths[i];
    }
    return null;
  }

  function applyColumnWidth(table, key, widthPx) {
    if (!table || !key) return;
    var w = Math.max(MIN_COL_W, Math.round(widthPx));
    getColumnWidthMap()[key] = w;
    var col = findColByKey(table, key);
    if (col) col.style.width = w + 'px';
    var th = findThByKey(table, key);
    if (th) {
      th.style.width = w + 'px';
      th.style.minWidth = w + 'px';
    }
    var sum = 0;
    var hasAny = false;
    var cols = table.querySelectorAll('col[data-col-key]');
    var i;
    for (i = 0; i < cols.length; i++) {
      var ck = cols[i].getAttribute('data-col-key');
      var stored = getColumnWidthMap()[ck];
      if (stored) {
        hasAny = true;
        sum += stored;
      } else {
        sum += Math.max(MIN_COL_W, Math.round(cols[i].getBoundingClientRect().width) || 96);
      }
    }
    if (hasAny) table.style.minWidth = sum + 'px';
  }

  function endColumnResize() {
    if (!colResizeState) return;
    var handle = colResizeState.handle;
    var pointerId = colResizeState.pointerId;
    colResizeState = null;
    if (handle) {
      handle.removeEventListener('pointermove', onColumnResizePointerMove);
      handle.removeEventListener('pointerup', onColumnResizePointerUp);
      handle.removeEventListener('pointercancel', onColumnResizePointerUp);
      if (pointerId != null) {
        try { handle.releasePointerCapture(pointerId); } catch (e) { /* ignore */ }
      }
    }
    if (document.body) document.body.classList.remove('fd-matrix-col-resizing');
    persistColumnWidths();
  }

  function onColumnResizePointerMove(e) {
    if (!colResizeState) return;
    var next = colResizeState.startW + (e.clientX - colResizeState.startX);
    applyColumnWidth(colResizeState.table, colResizeState.key, next);
  }

  function onColumnResizePointerUp() {
    endColumnResize();
  }

  function bindColumnResize(scope) {
    var root = scope || matrixEl;
    if (!root) return;
    var table = root.querySelector('.fd-matrix-table');
    if (!table || table._fdColResizeBound) return;
    table._fdColResizeBound = true;

    table.addEventListener('pointerdown', function (e) {
      var handle = e.target && e.target.closest
        ? e.target.closest('[data-col-resize]')
        : null;
      if (!handle || !table.contains(handle)) return;
      e.preventDefault();
      e.stopPropagation();
      var key = handle.getAttribute('data-col-resize');
      var th = handle.closest('th');
      if (!key || !th) return;
      if (colResizeState) endColumnResize();
      colResizeState = {
        key: key,
        table: table,
        handle: handle,
        startX: e.clientX,
        startW: th.getBoundingClientRect().width,
        pointerId: e.pointerId,
      };
      if (document.body) document.body.classList.add('fd-matrix-col-resizing');
      handle.addEventListener('pointermove', onColumnResizePointerMove);
      handle.addEventListener('pointerup', onColumnResizePointerUp);
      handle.addEventListener('pointercancel', onColumnResizePointerUp);
      try { handle.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
  }

  function renderSortOptions() {
    var options = [
      { value: 'insertion', label: 'Insertion Order (Default)' },
      { value: 'chronological', label: 'Chronological/Path Order' },
      { value: 'cindex', label: 'Ascending C-Index (C1, C2, C3...)' }
    ];
    var html = '';
    options.forEach(function (opt) {
      html += '<option value="' + opt.value + '"' +
        (activeSortMode === opt.value ? ' selected' : '') + '>' +
        opt.label + '</option>';
    });
    return html;
  }

  function getCurrentMatrixRows() {
    var mgr = getManager();
    if (activeMatrixTab === 'ring') {
      return mgr && mgr.getRingMatrixRows ? mgr.getRingMatrixRows() : [];
    }
    /* Strict per-FDT partition: prefer live active FDT over "all" */
    var liveFdt = resolveActiveFdtFilterId();
    var cabinetFilter = activeCabinetFilter;
    if (liveFdt && (cabinetFilter === 'all' || !cabinetFilter)) {
      cabinetFilter = String(liveFdt);
      activeCabinetFilter = cabinetFilter;
    }
    var rows = mgr && mgr.getSpliceMatrixRows
      ? mgr.getSpliceMatrixRows({
        cabinet: cabinetFilter,
        closure: activeClosureFilter,
      })
      : [];
    rows = sortRowsByMode(rows);
    /*
     * Per-cabinet view: renumber PLC in display order within this FDT domain.
     */
    if (cabinetFilter !== 'all' && activeClosureFilter === 'all' &&
        mgr && typeof mgr.applyPlcSplitterMapping === 'function') {
      rows = mgr.applyPlcSplitterMapping(rows);
    }
    return rows;
  }

  function renderMatrixTabs() {
    return '<div class="fd-float__tabs" role="tablist" aria-label="Fiber Design Matrix views">' +
      '<button type="button" class="fd-float__tab' +
      (activeMatrixTab === 'distribution' ? ' is-active' : '') +
      '" role="tab" aria-selected="' + (activeMatrixTab === 'distribution' ? 'true' : 'false') +
      '" data-matrix-tab="distribution">Distribution Matrix</button>' +
      '<button type="button" class="fd-float__tab' +
      (activeMatrixTab === 'ring' ? ' is-active' : '') +
      '" role="tab" aria-selected="' + (activeMatrixTab === 'ring' ? 'true' : 'false') +
      '" data-matrix-tab="ring">Ring Fiber Design (OLT to Cabinets)</button>' +
      '</div>';
  }

  function getMatrixFilterSummary() {
    var cabLabel = activeCabinetFilter === 'all' ? 'All Cabinets' : String(activeCabinetFilter);
    var cloLabel = activeClosureFilter === 'all' ? 'All Closures' : String(activeClosureFilter);
    var sortLabel = 'Ascending C-Index';
    if (activeSortMode === 'insertion') sortLabel = 'Insertion Order';
    else if (activeSortMode === 'chronological') sortLabel = 'Chronological/Path Order';
    else if (activeSortMode === 'cindex') sortLabel = 'Ascending C-Index';

    if (matrixEl) {
      var cabSel = matrixEl.querySelector('#fd-matrix-cabinet-filter');
      var cloSel = matrixEl.querySelector('#fd-matrix-closure-filter');
      if (cabSel && cabSel.selectedOptions && cabSel.selectedOptions[0]) {
        cabLabel = cabSel.selectedOptions[0].textContent || cabLabel;
      }
      if (cloSel && cloSel.selectedOptions && cloSel.selectedOptions[0]) {
        cloLabel = cloSel.selectedOptions[0].textContent || cloLabel;
      }
    }
    return {
      cabinet: cabLabel,
      closure: cloLabel,
      sort: sortLabel,
    };
  }

  function buildMatrixPrintStyles() {
    return [
      '@page{size:A4 landscape;margin:10mm;}',
      '*{box-sizing:border-box;}',
      'html,body{margin:0;padding:0;background:#ffffff;color:#111111;',
      'font-family:Arial,Helvetica,sans-serif;}',
      'body{padding:8px 12px;}',
      '.fd-print-report__title{margin:0 0 4px;font-size:16px;font-weight:700;color:#0f172a;}',
      '.fd-print-report__meta{margin:0 0 10px;font-size:10px;color:#334155;line-height:1.45;}',
      '.fd-print-report__meta strong{color:#0f172a;}',
      '.fd-matrix-scroll{overflow:visible!important;max-width:none!important;border:1px solid #cbd5e1;border-radius:0;}',
      '.fd-matrix-table{width:100%;border-collapse:collapse;min-width:0!important;font-size:9px;table-layout:auto;}',
      '.fd-matrix-table thead{display:table-header-group;}',
      '.fd-matrix-table thead th{',
      'position:static!important;padding:5px 6px;text-align:left;background:#e2e8f0!important;color:#0f172a!important;',
      'font-weight:700;border:1px solid #94a3b8;white-space:nowrap;font-size:8px;text-transform:uppercase;}',
      '.fd-matrix-table tbody td{',
      'padding:4px 6px;border:1px solid #94a3b8;color:#0f172a;vertical-align:middle;background:#ffffff;}',
      '.fd-matrix-table tbody tr{page-break-inside:avoid;}',
      '.fd-matrix-table tbody tr:nth-child(even) td{background:#f8fafc;}',
      '.fd-matrix-cell--color{font-weight:700;text-transform:capitalize;}',
      '.fd-matrix-cell--empty-color{background:transparent!important;color:inherit;font-weight:400;text-transform:none;}',
      '.fd-matrix-cell--type-main{font-weight:700;color:#166534;}',
      '.fd-matrix-cell--type-expansion{font-weight:700;color:#1d4ed8;}',
      '.fd-matrix-empty,.fd-matrix-error{padding:12px;border:1px dashed #94a3b8;color:#475569;text-align:center;}',
      '.fd-matrix-col-resizer{display:none!important;}',
      '.fd-print-no-print{display:none!important;}',
      '@media print{',
      'body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
      '.fd-print-no-print{display:none!important;}',
      '}',
    ].join('');
  }

  function hexToRgb(hex) {
    if (!hex) return [255, 255, 255];
    var h = String(hex).replace('#', '');
    if (h.length === 3) {
      h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16),
    ];
  }

  function formatMatrixCellText(row, col) {
    var rawVal = row[col.key];
    var val = !isBlankMatrixValue(rawVal) ? String(rawVal) : '';
    if (col.key === 'fat_id' && val) {
      var num = val.match(/(\d+)/);
      val = num ? num[1] : val;
    }
    if (col.colorCell && isBlankMatrixValue(rawVal)) return '';
    if (col.tubeCell) {
      var tubeSrc = row.tube_color || rawVal;
      return isBlankMatrixValue(tubeSrc) ? '' : String(tubeSrc);
    }
    if (col.fiberCell) {
      var fiberSrc = row.fiber_color || rawVal;
      return isBlankMatrixValue(fiberSrc) ? '' : String(fiberSrc);
    }
    return val;
  }

  function getMatrixCellPdfColors(srcRow, col) {
    var defaultText = [15, 23, 42];
    var defaultFill = [255, 255, 255];

    if (col.colorCell) {
      var raw = srcRow[col.key];
      if (isBlankMatrixValue(raw)) {
        return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      }
      var key = String(raw).trim().toLowerCase();
      var bg = FIBER_COLOR_CSS[key];
      if (!bg) return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      return {
        fillColor: hexToRgb(bg),
        textColor: (key === 'white' || key === 'yellow') ? hexToRgb('#0f172a') : hexToRgb('#f8fafc'),
        fontStyle: 'bold',
      };
    }
    if (col.tubeCell) {
      var tubeSrc = srcRow.tube_color || srcRow[col.key];
      if (isBlankMatrixValue(tubeSrc)) {
        return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      }
      var tKey = String(tubeSrc).trim().toLowerCase();
      var tBg = FIBER_COLOR_CSS[tKey];
      if (!tBg) return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      return {
        fillColor: hexToRgb(tBg),
        textColor: (tKey === 'white' || tKey === 'yellow') ? hexToRgb('#0f172a') : hexToRgb('#f8fafc'),
        fontStyle: 'bold',
      };
    }
    if (col.fiberCell) {
      var fiberSrc = srcRow.fiber_color || srcRow[col.key];
      if (isBlankMatrixValue(fiberSrc)) {
        return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      }
      var fKey = String(fiberSrc).trim().toLowerCase();
      var fBg = FIBER_COLOR_CSS[fKey];
      if (!fBg) return { fillColor: defaultFill, textColor: defaultText, fontStyle: 'normal' };
      return {
        fillColor: hexToRgb(fBg),
        textColor: (fKey === 'white' || fKey === 'yellow') ? hexToRgb('#0f172a') : hexToRgb('#f8fafc'),
        fontStyle: 'bold',
      };
    }
    if (col.key === 'fiber_type') {
      var typeVal = String(srcRow.fiber_type || '').toLowerCase();
      if (typeVal === 'main') {
        return { fillColor: defaultFill, textColor: hexToRgb('#166534'), fontStyle: 'bold' };
      }
      if (typeVal === 'expansion') {
        return { fillColor: defaultFill, textColor: hexToRgb('#1d4ed8'), fontStyle: 'bold' };
      }
    }
    return null;
  }

  var PDF_PAGE_1_MAX_ROWS = 30;
  var PDF_PAGE_N_MAX_ROWS = 32;
  var PDF_CLOSURE_GROUP_BORDER_MM = 0.35;

  function getMatrixPdfClosureGroupFields(isRing) {
    if (isRing) return ['ring_block_id', 'cabinet_id'];
    return ['m_cable_id', 'closure_id'];
  }

  function sliceMatrixRowsIntoClosureGroups(rows, groupFields) {
    var groups = [];
    if (!rows || !rows.length) return groups;
    var fields = groupFields && groupFields.length ? groupFields : ['m_cable_id', 'closure_id'];
    var i = 0;
    while (i < rows.length) {
      var baseKey = groupKeyForRow(rows[i], fields);
      var span = 1;
      while (i + span < rows.length &&
        groupKeyForRow(rows[i + span], fields) === baseKey) {
        span++;
      }
      groups.push(rows.slice(i, i + span));
      i += span;
    }
    return groups;
  }

  /**
   * PDF-only: split rowspan at fixed row budgets per page so autotable does not
   * push whole closure groups to the next page (re-merges parents per segment).
   */
  function applyPdfSmartSpanBreakRows(rows, rowspanKeys, isRing) {
    if (!rows || !rows.length) return [];
    var page1Max = PDF_PAGE_1_MAX_ROWS;
    var pageNMax = PDF_PAGE_N_MAX_ROWS;
    var pageIndex = 0;
    var pageRowCount = 0;
    var out = [];
    var groups = sliceMatrixRowsIntoClosureGroups(rows, getMatrixPdfClosureGroupFields(isRing));
    var gi;

    function pageMaxRows() {
      return pageIndex === 0 ? page1Max : pageNMax;
    }

    function beginNewPdfPage() {
      pageIndex += 1;
      pageRowCount = 0;
    }

    for (gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      var offset = 0;
      while (offset < group.length) {
        if (pageRowCount >= pageMaxRows()) beginNewPdfPage();
        var spaceLeft = pageMaxRows() - pageRowCount;
        if (spaceLeft <= 0) {
          beginNewPdfPage();
          spaceLeft = pageMaxRows();
        }
        var take = Math.min(spaceLeft, group.length - offset);
        var segment = group.slice(offset, offset + take);
        var annotatedSegment = applyRowspanMetadata(segment.slice(), rowspanKeys);
        if (offset + take >= group.length) {
          annotatedSegment[annotatedSegment.length - 1]._pdfClosureGroupEnd = true;
        }
        var si;
        for (si = 0; si < annotatedSegment.length; si++) {
          out.push(annotatedSegment[si]);
        }
        pageRowCount += take;
        offset += take;
      }
    }
    return out;
  }

  function buildAutoTableBodyWithRowspan(annotated, columns) {
    var body = [];
    var ri;
    for (ri = 0; ri < annotated.length; ri++) {
      var row = annotated[ri];
      var line = [];
      var ci;
      for (ci = 0; ci < columns.length; ci++) {
        var col = columns[ci];
        if (row['_skip_' + col.key]) continue;
        var text = formatMatrixCellText(row, col);
        var rs = row['_rs_' + col.key] || 1;
        if (rs > 1) {
          line.push({ content: text, rowSpan: rs });
        } else {
          line.push(text);
        }
      }
      body.push(line);
    }
    return body;
  }

  function applyMatrixPdfCellStyles(data, columns, annotated) {
    if (data.section !== 'body') return;
    var col = columns[data.column.index];
    if (!col) return;
    var srcRow = annotated[data.row.index];
    if (!srcRow) return;
    var colors = getMatrixCellPdfColors(srcRow, col);
    if (colors) {
      data.cell.styles.fillColor = colors.fillColor;
      data.cell.styles.textColor = colors.textColor;
      if (colors.fontStyle) data.cell.styles.fontStyle = colors.fontStyle;
      return;
    }
    if (data.row.index % 2 === 1) {
      data.cell.styles.fillColor = [248, 250, 252];
    }
    if (srcRow._pdfClosureGroupEnd) {
      var lw = data.cell.styles.lineWidth;
      if (lw == null || typeof lw === 'number') {
        var base = typeof lw === 'number' ? lw : 0.1;
        data.cell.styles.lineWidth = {
          top: base,
          right: base,
          bottom: PDF_CLOSURE_GROUP_BORDER_MM,
          left: base,
        };
      } else {
        data.cell.styles.lineWidth = Object.assign({}, lw, { bottom: PDF_CLOSURE_GROUP_BORDER_MM });
      }
    }
  }

  function buildMatrixAutoTableOptions(columns, margin) {
    return {
      margin: margin,
      theme: 'grid',
      tableWidth: 'auto',
      pageBreak: 'auto',
      rowPageBreak: 'auto',
      styles: {
        font: 'helvetica',
        fontSize: 7,
        cellPadding: 1.4,
        overflow: 'linebreak',
        valign: 'middle',
        lineColor: [148, 163, 184],
        lineWidth: 0.1,
        textColor: [15, 23, 42],
        fillColor: [255, 255, 255],
      },
      headStyles: {
        fillColor: [226, 232, 240],
        textColor: [15, 23, 42],
        fontStyle: 'bold',
        fontSize: 6.5,
        halign: 'left',
      },
    };
  }

  function buildMatrixPdfFilename(isRing) {
    var prefix = isRing ? 'ring-fiber-design' : 'fiber-design-matrix';
    var stamp = new Date();
    var y = stamp.getFullYear();
    var m = stamp.getMonth() + 1;
    var d = stamp.getDate();
    var hh = stamp.getHours();
    var mm = stamp.getMinutes();
    function pad2(n) { return n < 10 ? '0' + n : String(n); }
    return prefix + '-' + y + pad2(m) + pad2(d) + '-' + pad2(hh) + pad2(mm) + '.pdf';
  }

  function buildMatrixPrintDocument(rows) {
    var summary = getMatrixFilterSummary();
    var stamp = new Date();
    var stampText = stamp.toLocaleString();
    var isRing = activeMatrixTab === 'ring';
    var title = isRing
      ? 'Ring Fiber Design (OLT to Cabinets)'
      : 'Fiber Design Matrix';
    var tableHtml = isRing
      ? renderMatrixTable(rows || [], {
        columns: RING_MATRIX_COLUMNS,
        rowspanKeys: RING_ROWSPAN_GROUP_KEYS,
        emptyText: 'No OLT feeder → cabinet allocations found.',
      })
      : renderMatrixTable(rows || []);
    var meta = isRing
      ? ('<strong>Generated:</strong> ' + escapeHtml(stampText) +
        ' · <strong>Rule:</strong> 1 tube / cabinet · Main S1 (IN01–12→IN1) + Backup S2 (IN13–24→IN2)' +
        ' · <strong>Rows:</strong> ' + String((rows && rows.length) || 0))
      : ('<strong>Generated:</strong> ' + escapeHtml(stampText) + ' · ' +
        '<strong>Cabinet:</strong> ' + escapeHtml(summary.cabinet) + ' · ' +
        '<strong>Closure:</strong> ' + escapeHtml(summary.closure) + ' · ' +
        '<strong>Sort:</strong> ' + escapeHtml(summary.sort) + ' · ' +
        '<strong>Rows:</strong> ' + String((rows && rows.length) || 0));
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<title>' + escapeHtml(title) + '</title>' +
      '<style>' + buildMatrixPrintStyles() + '</style></head><body>' +
      '<header class="fd-print-report__header">' +
      '<h1 class="fd-print-report__title">' + escapeHtml(title) + '</h1>' +
      '<p class="fd-print-report__meta">' + meta + '</p></header>' +
      tableHtml +
      '</body></html>';
  }

  function exportMatrixPdf() {
    try {
      if (!window.jspdf || !window.jspdf.jsPDF) {
        window.alert('PDF export libraries failed to load. Please refresh the page and try again.');
        return;
      }
      var rows = getCurrentMatrixRows();
      var isRing = activeMatrixTab === 'ring';
      var columns = isRing ? RING_MATRIX_COLUMNS : MATRIX_COLUMNS;
      var rowspanKeys = isRing ? RING_ROWSPAN_GROUP_KEYS : ROWSPAN_GROUP_KEYS;
      var title = isRing
        ? 'Ring Fiber Design (OLT to Cabinets)'
        : 'Fiber Design Matrix';
      var summary = getMatrixFilterSummary();
      var stampText = new Date().toLocaleString();
      var headers = columns.map(function (col) { return col.label; });
      var margin = { top: 14, right: 8, bottom: 8, left: 8 };
      var tableBaseOptions = buildMatrixAutoTableOptions(columns, margin);

      var jsPDF = window.jspdf.jsPDF;
      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      var pageW = doc.internal.pageSize.getWidth();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(15, 23, 42);
      doc.text(title, margin.left, 10);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      var meta = isRing
        ? ('Generated: ' + stampText +
          '  |  Rule: 1 tube / cabinet  |  Main S1 + Backup S2  |  Rows: ' +
          String((rows && rows.length) || 0))
        : ('Generated: ' + stampText +
          '  |  Cabinet: ' + summary.cabinet +
          '  |  Closure: ' + summary.closure +
          '  |  Sort: ' + summary.sort +
          '  |  Rows: ' + String((rows && rows.length) || 0));
      doc.text(meta, margin.left, 14.5, { maxWidth: pageW - margin.left - margin.right });

      if (!rows || !rows.length) {
        doc.setFontSize(9);
        doc.setTextColor(71, 85, 105);
        doc.text(
          isRing ? 'No OLT feeder to cabinet allocations found.' : 'No splice rows for the current filters.',
          margin.left,
          22
        );
        doc.save(buildMatrixPdfFilename(isRing));
        return;
      }

      if (typeof doc.autoTable !== 'function') {
        window.alert('PDF table plugin failed to load. Please refresh the page and try again.');
        return;
      }

      var annotated = applyPdfSmartSpanBreakRows(rows.slice(), rowspanKeys, isRing);
      var body = buildAutoTableBodyWithRowspan(annotated, columns);

      doc.autoTable(Object.assign({}, tableBaseOptions, {
        head: [headers],
        body: body,
        startY: 18,
        showHead: 'everyPage',
        didParseCell: function (data) {
          applyMatrixPdfCellStyles(data, columns, annotated);
        },
      }));

      doc.save(buildMatrixPdfFilename(isRing));
    } catch (e) {
      console.error('[FiberDesignUI] exportMatrixPdf EXCEPTION:', e.message || e);
      window.alert('Failed to export Fiber Design Matrix PDF.');
    }
  }

  function sortRowsByMode(rows) {
    if (!rows || !rows.length) return rows;
    var sorted = rows.slice();

    if (activeSortMode === 'insertion') {
      // Sort by closure_order (insertion order)
      sorted.sort(function (a, b) {
        var directCmp = compareDirectRowsLast(a, b);
        if (directCmp !== 0) return directCmp;
        if (a.closure_order !== b.closure_order) {
          return (a.closure_order || 0) - (b.closure_order || 0);
        }
        // Secondary sort by cabinet, then cable
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        return 0;
      });
    } else if (activeSortMode === 'chronological') {
      // Sort by closure_id (chronological/path order)
      sorted.sort(function (a, b) {
        var directCmp = compareDirectRowsLast(a, b);
        if (directCmp !== 0) return directCmp;
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        if (a.closure_id !== b.closure_id) {
          return String(a.closure_id).localeCompare(String(b.closure_id), undefined, { numeric: true });
        }
        return 0;
      });
    } else if (activeSortMode === 'cindex') {
      // Sort by C-index (extract numeric suffix from closure_id)
      sorted.sort(function (a, b) {
        var directCmp = compareDirectRowsLast(a, b);
        if (directCmp !== 0) return directCmp;
        function extractCIndex(closureId) {
          var m = String(closureId || '').match(/C(\d+)/i);
          return m ? parseInt(m[1], 10) : 0;
        }
        var aIndex = extractCIndex(a.closure_id);
        var bIndex = extractCIndex(b.closure_id);
        if (aIndex !== bIndex) return aIndex - bIndex;
        // Secondary sort by cabinet, then cable
        if (a.cabinet_label !== b.cabinet_label) {
          return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
        }
        if (a.m_cable_id !== b.m_cable_id) {
          return String(a.m_cable_id).localeCompare(String(b.m_cable_id), undefined, { numeric: true });
        }
        return 0;
      });
    } else {
      sorted.sort(compareDirectRowsLast);
    }
    return sorted;
  }

  function renderDistributionToolbar(rows) {
    return '<div class="fd-float__toolbar">' +
      '<label class="fd-float__filter-label" for="fd-matrix-cabinet-filter">Cabinet Filter</label>' +
      '<select id="fd-matrix-cabinet-filter" class="fd-float__filter-select">' +
      renderCabinetFilterOptions() +
      '</select>' +
      '<label class="fd-float__filter-label" for="fd-matrix-closure-filter">Closure Filter</label>' +
      '<select id="fd-matrix-closure-filter" class="fd-float__filter-select">' +
      renderClosureFilterOptions() +
      '</select>' +
      '<label class="fd-float__filter-label" for="fd-matrix-sort-mode" style="margin-left: 20px;">Sort By</label>' +
      '<select id="fd-matrix-sort-mode" class="fd-float__filter-select">' +
      renderSortOptions() +
      '</select>' +
      '<div style="display: inline-flex; align-items: center; gap: 8px; margin-left: 20px;">' +
      '<button id="btn-zoom-out" style="padding: 2px 10px; background: #2a2d3d; color: white; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-weight: bold;">-</button>' +
      '<span id="zoom-text-display" style="color: #a0aabf; font-size: 13px;">100%</span>' +
      '<button id="btn-zoom-in" style="padding: 2px 10px; background: #2a2d3d; color: white; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-weight: bold;">+</button>' +
      '</div>' +
      '<button type="button" id="btn-export-matrix-pdf" class="fd-float__export-btn" title="Export current matrix as PDF">' +
      'Export PDF</button>' +
      '<span class="fd-float__badge">AutoFiberEngine · DFS</span>' +
      '<span class="fd-float__row-count">' + rows.length + ' splice row(s)</span>' +
      '</div>';
  }

  function renderRingToolbar(rows) {
    return '<div class="fd-float__toolbar">' +
      '<span class="fd-float__badge">Ring Feeder · Main (S1) + Backup (S2)</span>' +
      '<span class="fd-float__hint-inline">Independent 12-row blocks · Main IN01–12/IN1 · Backup IN13–24/IN2</span>' +
      '<button type="button" id="btn-export-matrix-pdf" class="fd-float__export-btn" title="Export ring matrix as PDF">' +
      'Export PDF</button>' +
      '<span class="fd-float__row-count">' + rows.length + ' fiber row(s)</span>' +
      '</div>';
  }

  function renderMatrixBody() {
    if (DEBUG) {
    console.log('[FiberDesignUI] renderMatrixBody START');
    }
    try {
      var mgr = getManager();
      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody: manager=' + (mgr ? 'found' : 'null') +
        ', tab=' + activeMatrixTab);
      }

      var rows = getCurrentMatrixRows();
      var tableHtml;
      var toolbar;

      if (activeMatrixTab === 'ring') {
        toolbar = renderRingToolbar(rows);
        tableHtml = renderMatrixTable(rows, {
          columns: RING_MATRIX_COLUMNS,
          rowspanKeys: RING_ROWSPAN_GROUP_KEYS,
          emptyText: 'No OLT→Cabinet feeder allocations found. Draw an FTTH feeder (48/72/144/288F) from OLT to FDT cabinets.',
        });
      } else {
        toolbar = renderDistributionToolbar(rows);
        tableHtml = renderMatrixTable(rows);
      }

      if (DEBUG) {
      console.log('[FiberDesignUI] renderMatrixBody SUCCESS rows=' + (rows ? rows.length : 0));
      }

      return renderMatrixTabs() + toolbar + tableHtml;
    } catch (e) {
      console.error('[FiberDesignUI] renderMatrixBody EXCEPTION:', e.message);
      console.error('[FiberDesignUI] renderMatrixBody STACK:', e.stack);
      return renderMatrixTabs() +
        '<div class="fd-matrix-error">Error rendering matrix: ' + e.message + '</div>';
    }
  }

  function bindMatrixFilter(scope) {
    var root = scope || matrixEl;
    if (!root) return;

    var cabSel = root.querySelector('#fd-matrix-cabinet-filter');
    if (cabSel && !cabSel._fdBound) {
      cabSel._fdBound = true;
      cabSel.addEventListener('change', function () {
        activeCabinetFilter = cabSel.value || 'all';
        activeClosureFilter = 'all';
        refreshMatrix();
      });
    }

    var cloSel = root.querySelector('#fd-matrix-closure-filter');
    if (cloSel && !cloSel._fdBound) {
      cloSel._fdBound = true;
      cloSel.addEventListener('change', function () {
        activeClosureFilter = cloSel.value || 'all';
        refreshMatrix();
      });
    }

    var sortSel = root.querySelector('#fd-matrix-sort-mode');
    if (sortSel && !sortSel._fdBound) {
      sortSel._fdBound = true;
      sortSel.addEventListener('change', function () {
        activeSortMode = sortSel.value || 'insertion';
        refreshMatrix();
      });
    }

    var exportBtn = root.querySelector('#btn-export-matrix-pdf');
    if (exportBtn && !exportBtn._fdBound) {
      exportBtn._fdBound = true;
      exportBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        exportMatrixPdf();
      });
    }

    root.querySelectorAll('[data-matrix-tab]').forEach(function (tabBtn) {
      if (tabBtn._fdBound) return;
      tabBtn._fdBound = true;
      tabBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var next = tabBtn.getAttribute('data-matrix-tab') || 'distribution';
        if (next === activeMatrixTab) return;
        activeMatrixTab = next;
        refreshMatrix();
      });
    });

    bindColumnResize(root);
  }

  function refreshMatrix(payload) {
    if (!matrixEl || !matrixOpen) return;
    if (colResizeState) endColumnResize();
    var body = matrixEl.querySelector('.fd-float__body');
    if (!body) return;
    body.innerHTML = renderMatrixBody();
    bindMatrixFilter(body);
    if (payload && payload.reason === 'path-merged' && payload.merge) {
      matrixEl.setAttribute('data-last-merge-cable', String(payload.merge.cableId || ''));
    }
    if (payload && payload.reason === 'interactive-trail') {
      matrixEl.setAttribute('data-last-path-source', 'interactive-trail');
      matrixEl.setAttribute('data-design-version', String(payload.version || ''));
    }
  }

  function onPathMerged(payload) {
    refreshMatrix(payload || { reason: 'path-merged' });
  }

  function getMatrixWindow() {
    return matrixEl ? matrixEl.querySelector('.fd-float__window') : null;
  }

  function hostOffsetRect() {
    var host = getOverlayHost();
    return host ? host.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  }

  function onDragPointerDown(e) {
    if (e.button != null && e.button !== 0) return;
    if (resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var rect = win.getBoundingClientRect();
    var hostRect = hostOffsetRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left - hostRect.left,
      origTop: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    win.classList.add('is-dragging');
    e.preventDefault();
  }

  function onDragPointerMove(e) {
    if (!dragState || resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var dx = e.clientX - dragState.startX;
    var dy = e.clientY - dragState.startY;
    var left = Math.max(0, dragState.origLeft + dx);
    var top = Math.max(0, dragState.origTop + dy);
    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
    win.style.width = dragState.width + 'px';
    win.style.height = dragState.height + 'px';
  }

  function onDragPointerUp() {
    if (!dragState) return;
    var win = getMatrixWindow();
    if (win) win.classList.remove('is-dragging');
    dragState = null;
  }

  function onResizePointerDown(e, edges) {
    if (e.button != null && e.button !== 0) return;
    var win = getMatrixWindow();
    if (!win) return;
    var rect = win.getBoundingClientRect();
    var hostRect = hostOffsetRect();
    resizeState = {
      edges: edges,
      startX: e.clientX,
      startY: e.clientY,
      left: rect.left - hostRect.left,
      top: rect.top - hostRect.top,
      width: rect.width,
      height: rect.height,
    };
    win.classList.add('is-resizing');
    e.preventDefault();
    e.stopPropagation();
  }

  function onResizePointerMove(e) {
    if (!resizeState) return;
    var win = getMatrixWindow();
    if (!win) return;
    var hostRect = hostOffsetRect();
    var dx = e.clientX - resizeState.startX;
    var dy = e.clientY - resizeState.startY;
    var left = resizeState.left;
    var top = resizeState.top;
    var width = resizeState.width;
    var height = resizeState.height;
    var edges = resizeState.edges;

    if (edges.indexOf('e') >= 0) {
      width = Math.max(MIN_WIN_W, resizeState.width + dx);
    }
    if (edges.indexOf('s') >= 0) {
      height = Math.max(MIN_WIN_H, resizeState.height + dy);
    }
    if (edges.indexOf('w') >= 0) {
      width = Math.max(MIN_WIN_W, resizeState.width - dx);
      left = resizeState.left + (resizeState.width - width);
    }
    if (edges.indexOf('n') >= 0) {
      height = Math.max(MIN_WIN_H, resizeState.height - dy);
      top = resizeState.top + (resizeState.height - height);
    }

    left = Math.max(0, Math.min(left, hostRect.width - MIN_WIN_W));
    top = Math.max(0, Math.min(top, hostRect.height - MIN_WIN_H));
    width = Math.min(width, hostRect.width - left);
    height = Math.min(height, hostRect.height - top);

    win.style.left = left + 'px';
    win.style.top = top + 'px';
    win.style.width = width + 'px';
    win.style.height = height + 'px';
    win.style.right = 'auto';
    win.style.bottom = 'auto';
  }

  function onResizePointerUp() {
    if (!resizeState) return;
    var win = getMatrixWindow();
    if (win) win.classList.remove('is-resizing');
    resizeState = null;
  }

  function onWindowPointerMove(e) {
    if (resizeState) onResizePointerMove(e);
    else if (dragState) onDragPointerMove(e);
  }

  function onWindowPointerUp() {
    onResizePointerUp();
    onDragPointerUp();
  }

  function cleanupLegacyModalNodes() {
    var legacyBackdrop = document.getElementById('fd-matrix-modal-backdrop');
    if (legacyBackdrop && legacyBackdrop.parentNode) {
      legacyBackdrop.parentNode.removeChild(legacyBackdrop);
    }
    var legacyModal = document.getElementById('fd-matrix-modal');
    if (legacyModal && legacyModal.parentNode) {
      legacyModal.parentNode.removeChild(legacyModal);
    }
  }

  function bindResizeHandles(win) {
    if (!win || win._fdResizeBound) return;
    win._fdResizeBound = true;
    var handles = [
      { cls: 'fd-float__resize fd-float__resize--n', edges: 'n' },
      { cls: 'fd-float__resize fd-float__resize--s', edges: 's' },
      { cls: 'fd-float__resize fd-float__resize--e', edges: 'e' },
      { cls: 'fd-float__resize fd-float__resize--w', edges: 'w' },
      { cls: 'fd-float__resize fd-float__resize--ne', edges: 'ne' },
      { cls: 'fd-float__resize fd-float__resize--nw', edges: 'nw' },
      { cls: 'fd-float__resize fd-float__resize--se', edges: 'se' },
      { cls: 'fd-float__resize fd-float__resize--sw', edges: 'sw' },
    ];
    handles.forEach(function (h) {
      var el = document.createElement('div');
      el.className = h.cls;
      el.setAttribute('data-resize-edges', h.edges);
      el.addEventListener('pointerdown', function (e) {
        onResizePointerDown(e, h.edges);
      });
      win.appendChild(el);
    });
  }

  function bindMatrixWindowEvents() {
    if (!matrixEl || matrixEventsBound) return;
    matrixEventsBound = true;

    var win = getMatrixWindow();
    var header = matrixEl.querySelector('.fd-float__header');
    var closeBtn = matrixEl.querySelector('#fd-float-close');

    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeMatrix();
      });
    }

    if (header) {
      header.addEventListener('pointerdown', function (e) {
        if (e.target && e.target.closest && e.target.closest('button, select, input, a')) return;
        onDragPointerDown(e);
      });
    }

    if (win) bindResizeHandles(win);

    document.addEventListener('pointermove', onWindowPointerMove);
    document.addEventListener('pointerup', onWindowPointerUp);
    document.addEventListener('pointercancel', onWindowPointerUp);

    document.addEventListener('keydown', function (e) {
      if (!matrixOpen || e.key !== 'Escape') return;
      e.preventDefault();
      closeMatrix();
    }, true);

    // Bind zoom controls
    bindZoomControls();
  }

  // Zoom functionality
  var currentMatrixZoom = 1.0;
  var ZOOM_STEP = 0.1;
  var zoomDelegationBound = false;

  function bindZoomControls() {
    // Use event delegation for dynamically generated UI
    if (zoomDelegationBound) return;
    zoomDelegationBound = true;

    // Zoom button clicks - delegate to document
    document.addEventListener('click', function (e) {
      var target = e.target;
      var zoomInBtn = target.closest('#btn-zoom-in');
      var zoomOutBtn = target.closest('#btn-zoom-out');

      if (zoomInBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (currentMatrixZoom < 2.0) {
          currentMatrixZoom += ZOOM_STEP;
          applyMatrixZoom();
        }
      } else if (zoomOutBtn) {
        e.preventDefault();
        e.stopPropagation();
        if (currentMatrixZoom > 0.4) {
          currentMatrixZoom -= ZOOM_STEP;
          applyMatrixZoom();
        }
      } else if (target.closest('#btn-export-matrix-pdf')) {
        e.preventDefault();
        e.stopPropagation();
        if (matrixOpen) exportMatrixPdf();
      }
    });

    // Ctrl + Mouse Wheel zoom - delegate to document
    document.addEventListener('wheel', function (e) {
      if (e.ctrlKey) {
        // Check if target is inside matrix window
        var matrixWindow = e.target.closest('#fd-float-matrix');
        if (matrixWindow) {
          e.preventDefault();
          if (e.deltaY < 0) {
            if (currentMatrixZoom < 2.0) {
              currentMatrixZoom += ZOOM_STEP;
            }
          } else {
            if (currentMatrixZoom > 0.4) {
              currentMatrixZoom -= ZOOM_STEP;
            }
          }
          applyMatrixZoom();
        }
      }
    }, { passive: false });
  }

  function applyMatrixZoom() {
    var matrixScroll = document.querySelector('#fd-float-matrix .fd-matrix-scroll');
    if (matrixScroll) {
      matrixScroll.style.zoom = currentMatrixZoom;
    }
    var zoomTextDisplay = document.querySelector('#zoom-text-display');
    if (zoomTextDisplay) {
      zoomTextDisplay.innerText = Math.round(currentMatrixZoom * 100) + '%';
    }
  }

  function ensureMatrixWindow() {
    if (DEBUG) {
    console.log('[FiberDesignUI] ensureMatrixWindow START');
    }
    try {
      cleanupLegacyModalNodes();

      var host = getOverlayHost();
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow: host=' + (host ? 'found' : 'null'));
      }
      if (!host) {
        console.error('[FiberDesignUI] ensureMatrixWindow ERROR: host is null');
        return null;
      }

      if (matrixEl && matrixEl.isConnected && matrixEl.querySelector('.fd-float__body')) {
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow: reusing existing matrix element');
        }
        var existingWin = getMatrixWindow();
        if (existingWin && !existingWin._fdResizeBound) bindResizeHandles(existingWin);
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow SUCCESS (reused)');
        }
        return matrixEl;
      }

      matrixEl = document.getElementById('fd-float-matrix');
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow: existing matrixEl by id=' + (matrixEl ? 'found' : 'null'));
      }
      
      if (!matrixEl || !matrixEl.querySelector('.fd-float__body')) {
        if (DEBUG) {
        console.log('[FiberDesignUI] ensureMatrixWindow: creating/initializing matrixEl');
        }
        if (!matrixEl) {
          matrixEl = document.createElement('div');
          matrixEl.id = 'fd-float-matrix';
        }
        matrixEl.className = 'fd-float-host';
        matrixEl.setAttribute('hidden', 'true');
        matrixEl.setAttribute('aria-hidden', 'true');
        matrixEl.innerHTML =
          '<div class="fd-float__window" role="dialog" aria-modal="false" aria-labelledby="fd-float-title">' +
          '<header class="fd-float__header">' +
          '<div class="fd-float__header-text">' +
          '<h2 id="fd-float-title" class="fd-float__title">Fiber Design Matrix</h2>' +
          '<p class="fd-float__subtitle">Read-only · AutoFiberEngine DFS topology</p>' +
          '</div>' +
          '<button type="button" class="fd-float__close" id="fd-float-close" aria-label="Close">×</button>' +
          '</header>' +
          '<div class="fd-float__body"></div>' +
          '<footer class="fd-float__footer">' +
          '<span class="fd-float__hint">Drag header to move · Resize from any edge or corner · Map stays interactive</span>' +
          '</footer>' +
          '</div>';
      }

      if (matrixEl.parentNode !== host) {
        host.appendChild(matrixEl);
      }

      hideMatrix();
      bindMatrixWindowEvents();
      if (DEBUG) {
      console.log('[FiberDesignUI] ensureMatrixWindow SUCCESS');
      }
      return matrixEl;
    } catch (e) {
      console.error('[FiberDesignUI] ensureMatrixWindow EXCEPTION:', e.message);
      console.error('[FiberDesignUI] ensureMatrixWindow STACK:', e.stack);
      return null;
    }
  }

  function showMatrix() {
    if (DEBUG) {
    console.log('[FiberDesignUI] showMatrix START');
    }
    if (!matrixEl) {
      console.error('[FiberDesignUI] showMatrix ERROR: matrixEl is null');
      return;
    }
    matrixOpen = true;
    matrixEl.removeAttribute('hidden');
    matrixEl.hidden = false;
    matrixEl.classList.add('is-open');
    matrixEl.setAttribute('aria-hidden', 'false');
    if (DEBUG) {
    console.log('[FiberDesignUI] showMatrix SUCCESS');
    }
  }

  function hideMatrix() {
    matrixOpen = false;
    dragState = null;
    resizeState = null;
    if (!matrixEl) return;
    matrixEl.setAttribute('hidden', 'true');
    matrixEl.hidden = true;
    matrixEl.classList.remove('is-open');
    matrixEl.setAttribute('aria-hidden', 'true');
  }

  function openMatrix(options) {
    if (DEBUG) {
    console.log('[FiberDesignUI] openMatrix START');
    }
    try {
      options = options || {};
      if (!ensureMatrixWindow()) {
        console.error('[FiberDesignUI] openMatrix ERROR: ensureMatrixWindow returned false');
        return;
      }
      
      // Show window FIRST so user gets feedback even if engine is slow/buggy
      showMatrix();
      
      var mgr = getManager();
      if (mgr && mgr.AutoFiberEngine) {
        try {
          /* Always rescan live map state when opening — do not wait for draw events */
          if (mgr.AutoFiberEngine.scanMapAndRegenerate) {
            mgr.AutoFiberEngine.scanMapAndRegenerate();
          } else if (mgr.AutoFiberEngine.regenerate) {
            mgr.AutoFiberEngine.regenerate();
          }
        } catch (engineErr) {
          console.error('[FiberDesignUI] Engine regeneration failed:', engineErr);
          // Don't return; refreshMatrix will show the error state in the body
        }
      } else if (mgr && mgr.ensureDisplayData) {
        mgr.ensureDisplayData();
      }

      if (options.cabinetFilter != null) {
        activeCabinetFilter = String(options.cabinetFilter);
      } else {
        var liveFdt = resolveActiveFdtFilterId();
        activeCabinetFilter = liveFdt ? String(liveFdt) : 'all';
      }
      activeClosureFilter = options.closureFilter != null ? String(options.closureFilter) : 'all';
      
      refreshMatrix();
      if (DEBUG) {
      console.log('[FiberDesignUI] openMatrix SUCCESS');
      }
    } catch (e) {
      console.error('[FiberDesignUI] openMatrix EXCEPTION:', e.message);
      console.error('[FiberDesignUI] openMatrix STACK:', e.stack);
    }
  }

  function closeMatrix() {
    hideMatrix();
  }

  function ensureStyles() {
    var style = document.getElementById('ftth-fiber-design-ui-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'ftth-fiber-design-ui-style';
      document.head.appendChild(style);
    }
    stylesInjected = true;
    style.textContent = [
      /* Sidebar */
      '.sidebar-section--fiber-design{margin-top:0.35rem;}',
      '.fiber-design-panel--empty{padding:0.15rem 0;}',
      '.fiber-design-panel__empty,.fiber-design-panel__hint{',
      'margin:0;padding:0.45rem 0.55rem;border-radius:0.45rem;',
      'border:1px dashed rgba(100,116,139,0.35);font-size:0.62rem;',
      'font-style:italic;color:#64748b;background:rgba(15,23,42,0.35);}',
      '.fiber-design-panel__hint{font-style:normal;color:#94a3b8;}',
      '.fiber-design-tabs{display:flex;flex-wrap:wrap;gap:0.3rem;margin-bottom:0.55rem;}',
      '.fiber-design-tab{',
      'padding:0.28rem 0.5rem;border-radius:0.35rem;border:1px solid rgba(71,85,105,0.55);',
      'background:rgba(15,23,42,0.72);color:#cbd5e1;font-size:0.62rem;font-weight:700;',
      'font-family:ui-monospace,Consolas,monospace;cursor:pointer;line-height:1.2;}',
      '.fiber-design-tab:hover{border-color:rgba(148,163,184,0.55);color:#f1f5f9;}',
      '.fiber-design-tab--active{border-color:#FFD400;background:rgba(255,212,0,0.12);color:#FFD400;}',
      '.fiber-design-tab-content{min-height:2rem;}',
      '.fiber-design-cable-detail__meta{display:flex;flex-wrap:wrap;gap:0.35rem 0.6rem;',
      'margin:0 0 0.45rem;font-size:0.58rem;color:#64748b;}',
      '.fiber-design-cable-detail__dir{text-transform:uppercase;letter-spacing:0.06em;font-weight:700;}',
      '.fiber-design-cable-detail__name{font-family:ui-monospace,Consolas,monospace;color:#94a3b8;}',
      '.fiber-design-tubes{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:0.4rem;}',
      '.fiber-design-tube{border:1px solid rgba(51,65,85,0.55);border-radius:0.45rem;',
      'background:rgba(15,23,42,0.45);overflow:hidden;}',
      '.fiber-design-tube__head{display:flex;justify-content:space-between;gap:0.5rem;',
      'padding:0.35rem 0.5rem;font-size:0.6rem;font-weight:700;color:#e2e8f0;',
      'background:rgba(30,41,59,0.55);border-bottom:1px solid rgba(51,65,85,0.45);}',
      '.fiber-design-tube__color{color:#94a3b8;font-weight:600;text-transform:capitalize;}',
      '.fiber-design-fibers{list-style:none;margin:0;padding:0.25rem 0;}',
      '.fiber-design-fiber{display:grid;grid-template-columns:1.5rem 1fr auto;gap:0.35rem;',
      'align-items:center;padding:0.22rem 0.5rem;font-size:0.58rem;color:#cbd5e1;}',
      '.fiber-design-fiber:nth-child(even){background:rgba(15,23,42,0.35);}',
      '.fiber-design-fiber__num{font-family:ui-monospace,Consolas,monospace;color:#64748b;}',
      '.fiber-design-fiber__color{text-transform:capitalize;}',
      '.fiber-design-fiber__status{font-size:0.54rem;text-transform:uppercase;letter-spacing:0.04em;',
      'padding:0.08rem 0.28rem;border-radius:0.25rem;background:rgba(51,65,85,0.45);color:#94a3b8;}',
      '.fiber-design-fiber__status--spliced{color:#4ade80;background:rgba(74,222,128,0.12);}',
      '.fiber-design-fiber__status--dark_fiber{color:#60a5fa;background:rgba(96,165,250,0.12);}',
      '.fiber-design-fiber__status--dead{color:#f87171;background:rgba(248,113,113,0.12);}',
      '.fiber-design-fiber--empty{font-style:italic;color:#64748b;padding:0.35rem 0.5rem;}',

      /* Floating window — host never captures map events */
      '.fd-float-host{display:none;position:absolute;inset:0;z-index:10050;pointer-events:none;}',
      '.fd-float-host.is-open{display:block;}',
      '.fd-float-host[hidden]{display:none !important;}',
      '.fd-float__window{',
      'position:absolute;left:4%;top:8%;width:min(72vw,920px);height:min(58vh,520px);',
      'min-width:360px;min-height:220px;max-width:96%;max-height:92%;',
      'display:flex;flex-direction:column;',
      'overflow:hidden;',
      'pointer-events:auto;',
      'border:1px solid rgba(71,85,105,0.9);border-radius:0.65rem;',
      'background:#0f172a;box-shadow:0 18px 50px rgba(0,0,0,0.5);}',
      '.fd-float__window.is-dragging,.fd-float__window.is-resizing{opacity:0.94;user-select:none;}',
      '.fd-float__header{',
      'display:flex;align-items:flex-start;justify-content:space-between;gap:0.75rem;',
      'padding:0.65rem 0.75rem;border-bottom:1px solid rgba(51,65,85,0.8);background:#111827;',
      'cursor:move;flex-shrink:0;touch-action:none;}',
      '.fd-float__title{margin:0;font-size:0.88rem;font-weight:700;color:#f8fafc;}',
      '.fd-float__subtitle{margin:0.15rem 0 0;font-size:0.62rem;color:#94a3b8;}',
      '.fd-float__close{',
      'border:none;background:rgba(51,65,85,0.55);color:#e2e8f0;border-radius:0.35rem;',
      'width:1.85rem;height:1.85rem;font-size:1.15rem;line-height:1;cursor:pointer;flex-shrink:0;}',
      '.fd-float__close:hover{background:rgba(71,85,105,0.85);}',
      '.fd-float__body{flex:1;min-height:0;overflow:auto;padding:0.65rem 0.75rem;}',
      '.fd-float__footer{',
      'padding:0.4rem 0.75rem;border-top:1px solid rgba(51,65,85,0.65);background:#0b1220;flex-shrink:0;}',
      '.fd-float__hint{font-size:0.58rem;color:#64748b;}',
      '.fd-float__toolbar{',
      'display:flex;flex-wrap:wrap;align-items:center;gap:0.45rem 0.75rem;margin-bottom:0.65rem;}',
      '.fd-float__filter-label{font-size:0.62rem;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;}',
      '.fd-float__filter-select{',
      'min-width:9.5rem;padding:0.3rem 0.45rem;border-radius:0.3rem;',
      'border:1px solid rgba(71,85,105,0.8);background:#1e293b;color:#f8fafc;font-size:0.68rem;}',
      '.fd-float__badge{',
      'font-size:0.58rem;padding:0.12rem 0.4rem;border-radius:0.25rem;',
      'background:rgba(56,189,248,0.12);color:#38bdf8;border:1px solid rgba(56,189,248,0.3);}',
      '.fd-float__row-count{margin-left:auto;font-size:0.6rem;color:#64748b;font-family:ui-monospace,Consolas,monospace;}',
      '.fd-float__export-btn{',
      'margin-left:0.35rem;padding:0.28rem 0.65rem;border-radius:0.3rem;cursor:pointer;',
      'border:1px solid rgba(56,189,248,0.45);background:rgba(14,165,233,0.18);color:#7dd3fc;',
      'font-size:0.65rem;font-weight:700;letter-spacing:0.02em;}',
      '.fd-float__export-btn:hover{background:rgba(14,165,233,0.32);color:#e0f2fe;}',
      '.fd-float__tabs{display:flex;flex-wrap:wrap;gap:0.35rem;margin:0 0 0.65rem;}',
      '.fd-float__tab{',
      'border:1px solid rgba(71,85,105,0.85);background:#1e293b;color:#94a3b8;',
      'border-radius:0.35rem;padding:0.35rem 0.65rem;font-size:0.68rem;font-weight:700;',
      'cursor:pointer;}',
      '.fd-float__tab:hover{color:#e2e8f0;border-color:rgba(148,163,184,0.7);}',
      '.fd-float__tab.is-active{',
      'background:rgba(14,165,233,0.2);border-color:rgba(56,189,248,0.55);color:#7dd3fc;}',
      '.fd-float__hint-inline{font-size:0.6rem;color:#64748b;}',
      '.fd-matrix-cell--striped{box-shadow:inset 0 0 0 1px rgba(255,255,255,0.25);}',
      /* OS-style resize handles (all edges + corners) */
      '.fd-float__resize{position:absolute;z-index:5;background:transparent;}',
      '.fd-float__resize--n{left:8px;right:8px;top:-3px;height:8px;cursor:ns-resize;}',
      '.fd-float__resize--s{left:8px;right:8px;bottom:-3px;height:8px;cursor:ns-resize;}',
      '.fd-float__resize--e{top:8px;bottom:8px;right:-3px;width:8px;cursor:ew-resize;}',
      '.fd-float__resize--w{top:8px;bottom:8px;left:-3px;width:8px;cursor:ew-resize;}',
      '.fd-float__resize--ne{top:-4px;right:-4px;width:14px;height:14px;cursor:nesw-resize;}',
      '.fd-float__resize--nw{top:-4px;left:-4px;width:14px;height:14px;cursor:nwse-resize;}',
      '.fd-float__resize--se{bottom:-4px;right:-4px;width:14px;height:14px;cursor:nwse-resize;}',
      '.fd-float__resize--sw{bottom:-4px;left:-4px;width:14px;height:14px;cursor:nesw-resize;}',
      '.fd-matrix-scroll{overflow:auto;max-width:100%;border:1px solid rgba(51,65,85,0.75);border-radius:0.4rem;}',
      '.fd-matrix-table{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;min-width:900px;font-size:0.65rem;}',
      '.fd-matrix-table thead th{',
      'position:sticky;top:0;z-index:2;padding:0.4rem 0.65rem 0.4rem 0.5rem;text-align:left;',
      'background:#1e293b;color:#cbd5e1;font-weight:700;border-bottom:1px solid rgba(71,85,105,0.85);',
      'border-right:1px solid rgba(71,85,105,0.55);',
      'white-space:nowrap;font-size:0.58rem;text-transform:uppercase;letter-spacing:0.04em;',
      'overflow:hidden;user-select:none;-webkit-user-select:none;',
      'box-sizing:border-box;}',
      '.fd-matrix-th__label{display:block;overflow:hidden;text-overflow:ellipsis;}',
      '.fd-matrix-col-resizer{',
      'position:absolute;top:0;right:-3px;width:7px;height:100%;cursor:col-resize;z-index:3;',
      'touch-action:none;}',
      '.fd-matrix-col-resizer:hover,.fd-matrix-col-resizer:active{',
      'background:linear-gradient(90deg,transparent 2px,rgba(56,189,248,0.85) 2px,rgba(56,189,248,0.85) 4px,transparent 4px);}',
      'body.fd-matrix-col-resizing,body.fd-matrix-col-resizing *{cursor:col-resize!important;user-select:none!important;}',
      '.fd-matrix-table tbody td{',
      'padding:0.3rem 0.5rem;border-bottom:1px solid rgba(30,41,59,0.85);',
      'border-right:1px solid rgba(30,41,59,0.55);color:#e2e8f0;vertical-align:middle;',
      'overflow:hidden;text-overflow:ellipsis;}',
      '.fd-matrix-table tbody tr:nth-child(even) td{background:rgba(15,23,42,0.35);}',
      '.fd-matrix-cell--color{font-weight:700;text-transform:capitalize;text-shadow:0 1px 1px rgba(0,0,0,0.35);}',
      '.fd-matrix-cell--empty-color{background:transparent!important;background-image:none!important;',
      'color:inherit;font-weight:400;text-transform:none;text-shadow:none;}',
      '.fd-matrix-cell--tube{white-space:nowrap;}',
      '.fd-matrix-cell--type-main{font-weight:700;color:#4ade80;}',
      '.fd-matrix-cell--type-expansion{font-weight:700;color:#60a5fa;}',
      '.fd-matrix-empty{',
      'padding:1rem;border:1px dashed rgba(100,116,139,0.45);border-radius:0.4rem;',
      'color:#94a3b8;font-size:0.72rem;text-align:center;background:rgba(15,23,42,0.45);}',
    ].join('');
  }

  global.FTTHFiberDesignUI = {
    init: init,
    renderSection: renderSection,
    bind: bind,
    refreshPanelContent: refreshPanelContent,
    clearActiveTab: clearActiveTab,
    sortCablesForTabs: sortCablesForTabs,
    openMatrix: openMatrix,
    onActiveFdtChanged: function (fdtId) {
      /* Matrix stays on Active FDT domain; sidebar inspection remains free for any cabinet. */
      applyActiveFdtMatrixFilter(fdtId);
    },
    closeMatrix: closeMatrix,
    refreshMatrix: refreshMatrix,
    exportMatrixPdf: exportMatrixPdf,
    onPathMerged: onPathMerged,
    isMatrixOpen: function () { return matrixOpen; },
    open: openMatrix,
    close: closeMatrix,
    refresh: refreshMatrix,
  };
})(typeof window !== 'undefined' ? window : globalThis);
