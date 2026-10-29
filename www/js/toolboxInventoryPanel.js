/**

 * Toolbox inventory panel — audit icon click, direct DOM, read-only map query.

 */

(function (global) {

  'use strict';



  var HIGHLIGHT_MS = 4500;



  var deps = {};

  var pinnedKey = null;

  var pinnedSpec = null;

  var pinnedAnchor = null;

  var panelEl = null;

  var highlightTimer = null;

  var boundBox = null;



  var EXCAV_TOOL_PREFIX = 'excav_';



  var AUDIT_ICON_SVG =

    '<svg class="toolbox-audit-btn__icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +

    '<path fill="currentColor" d="M4 6h16v2H4V6zm0 5h10v2H4v-2zm0 5h16v2H4v-2z"/>' +

    '</svg>';



  function init(injected) {

    deps = injected || {};

  }



  function getSim() {

    return deps.getSim ? deps.getSim() : null;

  }



  function shouldSkipAudit(toolId) {

    return toolId === 'splitter';

  }



  function ensureControls(el) {

    if (global.FTTHVisibilityManager?.ensureToolboxControls) {

      return global.FTTHVisibilityManager.ensureToolboxControls(el);

    }

    if (!el) return null;

    el.classList.add('toolbox-item--has-controls');

    var controls = el.querySelector(':scope > .toolbox-item-controls');

    if (!controls) {

      controls = document.createElement('div');

      controls.className = 'toolbox-item-controls';

      el.appendChild(controls);

    }

    return controls;

  }



  function appendAuditToControls(parent, btn) {

    if (!parent || !btn) return;

    var controls = parent.classList.contains('toolbox-item-controls')

      ? parent

      : ensureControls(parent);

    if (!controls || controls.querySelector('.toolbox-audit-btn')) return;

    var eye = controls.querySelector('.toolbox-visibility-btn');

    if (eye) controls.insertBefore(btn, eye);

    else controls.appendChild(btn);

  }



  function escapeHtml(str) {

    return String(str || '')

      .replace(/&/g, '&amp;')

      .replace(/</g, '&lt;')

      .replace(/>/g, '&gt;')

      .replace(/"/g, '&quot;');

  }



  function disambiguateEntries(entries) {

    var counts = {};

    entries.forEach(function (e) { counts[e.baseLabel] = (counts[e.baseLabel] || 0) + 1; });

    var seen = {};

    var hasDuplicates = false;

    var result = entries.map(function (e) {

      if (counts[e.baseLabel] <= 1) {

        return { kind: e.kind, id: e.id, label: e.baseLabel, panX: e.panX, panY: e.panY };

      }

      hasDuplicates = true;

      seen[e.baseLabel] = (seen[e.baseLabel] || 0) + 1;

      return {

        kind: e.kind,

        id: e.id,

        label: e.baseLabel + ' Instance ' + seen[e.baseLabel],

        panX: e.panX,

        panY: e.panY,

      };

    });

    // Update toolbox hint with duplication warning
    var hintElement = document.getElementById('toolbox-footer-hint');
    if (hintElement) {
      if (hasDuplicates) {
        hintElement.textContent = 'Duplicated ❗';
        hintElement.style.color = '#ff4d4d';
        hintElement.style.fontWeight = 'bold';
      } else {
        hintElement.textContent = '💡 على الرصيف فقط · FAT Pole فوق المثلث → FAT1';
        hintElement.style.color = '';
        hintElement.style.fontWeight = '';
      }
    }

    return result;

  }



  function pathMidpoint(points) {

    if (!points || !points.length) return null;

    if (points.length === 1) return { x: points[0][0], y: points[0][1] };

    var total = 0;

    var segs = [];

    for (var i = 1; i < points.length; i++) {

      var dx = points[i][0] - points[i - 1][0];

      var dy = points[i][1] - points[i - 1][1];

      var len = Math.sqrt(dx * dx + dy * dy);

      segs.push(len);

      total += len;

    }

    if (total < 1e-6) return { x: points[0][0], y: points[0][1] };

    var half = total / 2;

    var acc = 0;

    for (var j = 0; j < segs.length; j++) {

      if (acc + segs[j] >= half) {

        var t = (half - acc) / segs[j];

        return {

          x: points[j][0] + (points[j + 1][0] - points[j][0]) * t,

          y: points[j][1] + (points[j + 1][1] - points[j][1]) * t,

        };

      }

      acc += segs[j];

    }

    var last = points[points.length - 1];

    return { x: last[0], y: last[1] };

  }



  function pushNodeEntry(raw, node) {

    if (!node || node.id == null) return;

    var center = deps.getNodeCenterXY ? deps.getNodeCenterXY(node) : null;

    if (!center) return;

    var base = deps.getNodeAutoLabel ? deps.getNodeAutoLabel(node) : '';

    if (!base) base = String(node.id);

    raw.push({ kind: 'node', id: node.id, baseLabel: base, panX: center.x, panY: center.y });

  }



  function pushExcavationEntry(raw, path, labelPrefix) {

    if (!path || !path.id) return;

    var mid = pathMidpoint(path.points || []);

    if (!mid) return;

    var num = deps.getExcavationDisplayNumber ? deps.getExcavationDisplayNumber(path) : path.id;

    raw.push({

      kind: 'excavation',

      id: path.id,

      baseLabel: (labelPrefix ? labelPrefix + ' ' : '') + num,

      panX: mid.x,

      panY: mid.y,

    });

  }



  function pushCableEntry(raw, cable) {

    if (!cable || !cable.id) return;

    var geom = deps.getCableRenderGeometry ? deps.getCableRenderGeometry(cable) : { points: cable.points || [] };

    var mid = pathMidpoint(geom.points || cable.points);

    if (!mid) return;

    var base = deps.getCableDisplayBatchLabel ? deps.getCableDisplayBatchLabel(cable) : cable.id;

    raw.push({ kind: 'fiber', id: cable.id, baseLabel: base, panX: mid.x, panY: mid.y });

  }



  function queryMapInstances(spec) {

    var Sim = getSim();

    if (!Sim || !spec) return [];



    var raw = [];

    var toolId = spec.toolId;



    if (toolId === 'cable' || toolId === 'cable_group') {

      (Sim.fiberCablePaths || []).forEach(function (cable) {

        if (!cable || !cable.id) return;

        if (spec.cableKind && cable.kind !== spec.cableKind) return;

        if (spec.cableCap != null && (cable.capacity || 0) !== spec.cableCap) return;

        pushCableEntry(raw, cable);

      });

      return disambiguateEntries(raw);

    }



    if (toolId === 'category') {

      (Sim.nodes || []).forEach(function (node) {

        if (spec.categoryId === 'LM_Holes' && (node.type === 'handhole' || node.type === 'fat_handhole')) {

          pushNodeEntry(raw, node);

        } else if (spec.categoryId === 'LM_Poles' && node.type === 'fat_handhole' && node.hasFatPole) {

          pushNodeEntry(raw, node);

        }

      });

      return disambiguateEntries(raw);

    }



    if (toolId === 'olt' || toolId === 'fdt' || toolId === 'handhole' || toolId === 'fat_handhole') {

      (Sim.nodes || []).forEach(function (node) {

        if (node.type === toolId) pushNodeEntry(raw, node);

      });

      return disambiguateEntries(raw);

    }



    if (toolId === 'closure') {

      (Sim.nodes || []).forEach(function (node) {

        if (node.hasClosure && (node.type === 'handhole' || node.type === 'fat_handhole')) {

          pushNodeEntry(raw, node);

        }

      });

      return disambiguateEntries(raw);

    }



    if (toolId === 'fat_pole') {

      (Sim.nodes || []).forEach(function (node) {

        if (node.type === 'fat_handhole' && node.hasFatPole) pushNodeEntry(raw, node);

      });

      return disambiguateEntries(raw);

    }



    if (toolId && toolId.indexOf(EXCAV_TOOL_PREFIX) === 0) {

      var routeKind = deps.getExcavationRouteKind ? deps.getExcavationRouteKind(toolId) : null;

      (Sim.excavationPaths || []).forEach(function (path) {

        if (!path) return;

        if (routeKind && path.kind !== routeKind) return;

        pushExcavationEntry(raw, path, '');

      });

      return disambiguateEntries(raw);

    }



    if (toolId === 'pen_tool') {

      (Sim.excavationPaths || []).forEach(function (path) {

        pushExcavationEntry(raw, path, 'Path');

      });

      (Sim.fiberCablePaths || []).forEach(function (cable) {

        pushCableEntry(raw, cable);

      });

      return disambiguateEntries(raw);

    }



    return [];

  }



  function buildSpecFromAudit(filterType, filterValue, title) {

    if (filterType === 'cable_category') {

      var groupId = filterValue;

      var cableKind = groupId === 'lastmile' ? 'lastmile' : 'distribution';

      return {

        itemType: 'cable_group:' + groupId,

        toolId: 'cable_group',

        cableGroupId: groupId,

        cableKind: cableKind,

        title: title || (groupId === 'lastmile' ? 'LM- Cable' : 'FTTH Cable'),

      };

    }

    if (filterType === 'cable_capacity') {

      var parts = String(filterValue || '').split(':');

      var kind = parts[0];

      var cap = parseInt(parts[1], 10);

      return {

        itemType: 'cable:' + kind + ':' + cap,

        toolId: 'cable',

        cableKind: kind,

        cableCap: isFinite(cap) ? cap : null,

        title: title || (isFinite(cap) ? cap + 'F' : 'Cable'),

      };

    }

    if (filterType === 'category') {

      return {

        itemType: 'category:' + filterValue,

        toolId: 'category',

        categoryId: filterValue,

        title: title || filterValue,

      };

    }

    if (filterType === 'tool') {

      return {

        itemType: 'tool:' + filterValue,

        toolId: filterValue,

        title: title || filterValue,

      };

    }

    return null;

  }



  function clearHighlight() {

    if (highlightTimer) {

      clearTimeout(highlightTimer);

      highlightTimer = null;

    }

    document.querySelectorAll('.toolbox-inventory-highlight').forEach(function (el) {

      el.classList.remove('toolbox-inventory-highlight');

    });

  }



  function highlightEntry(entry) {

    clearHighlight();

    if (!entry) return;

    if (entry.kind === 'node') {

      var nodeEl = document.querySelector('.placed-node[data-id="' + entry.id + '"]');

      if (nodeEl) nodeEl.classList.add('toolbox-inventory-highlight');

    } else {

      var pathType = entry.kind === 'fiber' ? 'fiber' : 'excavation';

      document.querySelectorAll('[data-path-type="' + pathType + '"][data-path-id="' + entry.id + '"]').forEach(function (el) {

        if (el.classList.contains('draw-path-visible') || el.tagName === 'path' || el.tagName === 'line') {

          el.classList.add('toolbox-inventory-highlight');

        }

      });

    }

    highlightTimer = setTimeout(clearHighlight, HIGHLIGHT_MS);

  }



  function collapseInventoryPanel() {

    if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);

    panelEl = null;

    if (pinnedAnchor) pinnedAnchor.classList.remove('toolbox-item--inventory-expanded');

    pinnedAnchor = null;

    pinnedKey = null;

    pinnedSpec = null;

    clearHighlight();

    // Restore default toolbox hint when panel is closed
    var hintElement = document.getElementById('toolbox-footer-hint');
    if (hintElement) {
      hintElement.textContent = '💡 على الرصيف فقط · FAT Pole فوق المثلث → FAT1';
      hintElement.style.color = '';
      hintElement.style.fontWeight = '';
    }

  }



  function buildPanelDom(spec, entries) {

    var panel = document.createElement('div');

    panel.className = 'toolbox-inventory-panel';

    panel.setAttribute('role', 'region');



    var header = document.createElement('div');

    header.className = 'toolbox-inventory-panel__header';

    header.innerHTML =

      '<span class="toolbox-inventory-panel__title">' + escapeHtml(spec.title || 'Inventory') + '</span>' +

      '<button type="button" class="toolbox-inventory-panel__close" aria-label="Close">×</button>';

    header.querySelector('.toolbox-inventory-panel__close').addEventListener('click', function (e) {

      e.preventDefault();

      e.stopPropagation();

      collapseInventoryPanel();

    });

    panel.appendChild(header);



    var list = document.createElement('ul');

    list.className = 'toolbox-inventory-panel__list';

    if (!entries.length) {

      var empty = document.createElement('li');

      empty.className = 'toolbox-inventory-panel__empty';

      empty.textContent = 'No items on map';

      list.appendChild(empty);

    } else {

      entries.forEach(function (entry) {

        var li = document.createElement('li');

        var btn = document.createElement('button');

        btn.type = 'button';

        btn.className = 'toolbox-inventory-panel__item';

        btn.textContent = entry.label;

        btn.addEventListener('click', function (e) {

          e.preventDefault();

          e.stopPropagation();

          highlightEntry(entry);

          if (deps.panToCanvasPoint && isFinite(entry.panX) && isFinite(entry.panY)) {

            deps.panToCanvasPoint(entry.panX, entry.panY);

          }

        });

        li.appendChild(btn);

        list.appendChild(li);

      });

    }

    panel.appendChild(list);

    return panel;

  }



  function resolveInventoryInsertAfter(triggerEl, spec) {

    var panel = triggerEl && triggerEl.closest('.cable-config-panel');

    if (!panel && spec && spec.toolId === 'cable_group' && spec.cableGroupId) {

      panel = document.querySelector(

        '.toolbox-category[data-category-id="cable_' + spec.cableGroupId + '"] .cable-config-panel'

      );

    }

    if (panel) {

      var batchPreview = panel.querySelector('.cable-label-preview');

      if (batchPreview) return batchPreview;

      return panel;

    }

    if (triggerEl) {

      if (triggerEl.classList.contains('toolbox-category__header')) {

        var catBody = triggerEl.closest('.toolbox-category') &&

          triggerEl.closest('.toolbox-category').querySelector('.toolbox-category__body');

        if (catBody) return catBody;

      }

      if (triggerEl.classList.contains('toolbox-item') ||

          triggerEl.classList.contains('toolbox-card') ||

          triggerEl.classList.contains('pen-line-option') ||

          triggerEl.classList.contains('cable-cap-chip-wrap')) {

        return triggerEl;

      }

    }

    return triggerEl;

  }



  function toggleInventoryPanel(itemType, anchorEl, spec) {

    if (!itemType || !anchorEl || !spec) return;



    collapseInventoryPanel();



    pinnedKey = itemType;

    pinnedSpec = spec;



    var insertAfter = resolveInventoryInsertAfter(anchorEl, spec);

    pinnedAnchor = insertAfter;

    pinnedAnchor.classList.add('toolbox-item--inventory-expanded');



    var entries = queryMapInstances(spec);

    panelEl = buildPanelDom(spec, entries);

    insertAfter.insertAdjacentElement('afterend', panelEl);

  }



  function handleAuditClick(filterType, filterValue, anchorEl, title) {

    var spec = buildSpecFromAudit(filterType, filterValue, title);

    if (!spec || !anchorEl) return;

    toggleInventoryPanel(spec.itemType, anchorEl, spec);

  }



  function createAuditButton(filterType, filterValue, title) {

    var btn = document.createElement('button');

    btn.type = 'button';

    btn.className = 'toolbox-audit-btn';

    btn.dataset.auditFilterType = filterType;

    btn.dataset.auditFilterValue = filterValue;

    btn.dataset.auditTitle = title || '';

    btn.setAttribute('aria-label', 'Audit map inventory for ' + (title || filterValue));

    btn.title = 'Audit inventory';

    btn.innerHTML = AUDIT_ICON_SVG;

    return btn;

  }



  function mountAuditButton(el, filterType, filterValue, title) {

    if (!el || el.querySelector('.toolbox-audit-btn')) return;

    el.dataset.auditAnchor = '1';

    appendAuditToControls(el, createAuditButton(filterType, filterValue, title));

  }



  function resolveAuditAnchor(el) {

    return el.closest('[data-audit-anchor]') || el.closest('.toolbox-item') ||

      el.closest('.pen-line-option') || el.closest('.cable-cap-chip-wrap') ||

      el.closest('.toolbox-category__header') || el.parentElement;

  }



  function onAuditClick(e) {

    var btn = e.target.closest('.toolbox-audit-btn');

    if (!btn) return;

    e.preventDefault();

    e.stopPropagation();

    e.stopImmediatePropagation();

    handleAuditClick(

      btn.dataset.auditFilterType,

      btn.dataset.auditFilterValue,

      resolveAuditAnchor(btn),

      btn.dataset.auditTitle

    );

  }



  function injectCategoryAudits(box) {

    box.querySelectorAll('.toolbox-category[data-category-id]').forEach(function (wrap) {

      var header = wrap.querySelector(':scope > .toolbox-category__header') ||

        wrap.querySelector(':scope > .toolbox-category__header-wrap > .toolbox-category__header');

      if (!header || header.querySelector('.toolbox-audit-btn')) return;



      var catId = wrap.dataset.categoryId || '';

      var titleEl = wrap.querySelector('.toolbox-category__title');

      var titleText = titleEl ? titleEl.textContent.trim() : catId;



      if (catId.indexOf('cable_') === 0) {

        var groupId = catId === 'cable_lastmile' ? 'lastmile' : 'ftth';

        mountAuditButton(header, 'cable_category', groupId, titleText);

        return;

      }



      mountAuditButton(header, 'category', catId, titleText);

    });

  }



  function injectCapacityChipAudits(box) {

    box.querySelectorAll('.cable-cap-chip').forEach(function (chip) {

      var kind = chip.dataset.cableCap;

      var cap = chip.dataset.cap;

      if (!kind || !cap) return;



      var wrap = chip.closest('.cable-cap-chip-wrap');

      if (!wrap) {

        wrap = document.createElement('div');

        wrap.className = 'cable-cap-chip-wrap';

        chip.parentNode.insertBefore(wrap, chip);

        wrap.appendChild(chip);

      }



      mountAuditButton(wrap, 'cable_capacity', kind + ':' + cap, cap + 'F');

    });

  }



  function injectToolboxItemAudits(box) {

    box.querySelectorAll('.toolbox-item[data-type], .toolbox-card[data-type], .pen-line-option[data-line-id]').forEach(function (el) {

      var toolId = el.dataset.type || el.dataset.lineId;

      if (!toolId || shouldSkipAudit(toolId)) return;



      var labelEl = el.querySelector('.toolbox-item__text p, .toolbox-card__title');
      var title = labelEl ? labelEl.textContent.trim() : el.textContent.replace(/\s+/g, ' ').trim();
      mountAuditButton(el, 'tool', toolId, title || toolId);

    });

  }



  function injectAuditButtons(box) {

    if (!box) return;

    injectCategoryAudits(box);

    injectCapacityChipAudits(box);

    injectToolboxItemAudits(box);

  }



  function findAnchorForSpec(box, spec) {

    if (!box || !spec) return null;

    if (spec.toolId === 'cable_group' && spec.cableGroupId) {

      var catPanel = box.querySelector(

        '.toolbox-category[data-category-id="cable_' + spec.cableGroupId + '"] .cable-config-panel'

      );

      if (catPanel) {

        return catPanel.querySelector('.cable-label-preview') || catPanel;

      }

    }

    if (spec.toolId === 'cable' && spec.cableKind && spec.cableCap != null) {

      var configPanel = box.querySelector('.cable-config-panel--' + spec.cableKind);

      if (configPanel) {

        return configPanel.querySelector('.cable-label-preview') || configPanel;

      }

    }

    if (spec.toolId === 'category' && spec.categoryId) {

      var cat = box.querySelector('.toolbox-category[data-category-id="' + spec.categoryId + '"]');

      if (cat) {

        var body = cat.querySelector('.toolbox-category__body');

        return body || cat.querySelector('.toolbox-category__header');

      }

    }

    if (spec.toolId && spec.toolId !== 'cable_group' && spec.toolId !== 'cable') {

      var item = box.querySelector('[data-type="' + spec.toolId + '"], [data-line-id="' + spec.toolId + '"]');

      if (item) return item;

    }

    return null;

  }



  function restorePinnedPanel(box) {

    if (!pinnedKey || !pinnedSpec || !box) return;

    var anchor = findAnchorForSpec(box, pinnedSpec);

    if (anchor) toggleInventoryPanel(pinnedKey, anchor, pinnedSpec);

  }



  function bindToolbox(box) {

    if (!box) return;



    injectAuditButtons(box);



    if (boundBox === box && box.dataset.inventoryBound === '1') {

      if (pinnedKey && pinnedSpec) restorePinnedPanel(box);

      return;

    }



    boundBox = box;

    box.dataset.inventoryBound = '1';

    box.addEventListener('click', onAuditClick, true);



    if (pinnedKey && pinnedSpec) restorePinnedPanel(box);

  }



  global.FTTHToolboxInventory = {

    init: init,

    bindToolbox: bindToolbox,

    handleAuditClick: handleAuditClick,

    toggleInventoryPanel: toggleInventoryPanel,

    collapseInventoryPanel: collapseInventoryPanel,

    createAuditButton: createAuditButton,

  };

})(typeof window !== 'undefined' ? window : globalThis);


