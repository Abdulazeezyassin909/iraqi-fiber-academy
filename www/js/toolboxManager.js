/**
 * Toolbox Configuration Manager — overlay to enable/disable toolbox entries.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ftth_toolbox_manager_v1';

  var TOOL_CATALOG = [
    { id: 'olt', label: 'OLT / ITPC Exchange', group: 'Equipment' },
    { id: 'fdt', label: 'FDT', group: 'Equipment' },
    { id: 'closure', label: 'Closure', group: 'Equipment' },
    { id: 'splitter', label: 'Splitter', group: 'Equipment' },
    { id: 'handhole', label: 'Handhole', group: 'LM Holes' },
    { id: 'fat_handhole', label: 'FAT Handhole', group: 'LM Holes' },
    { id: 'fat_pole', label: 'FAT Pole', group: 'LM Poles' },
    { id: 'pen_tool', label: 'Pen Tool', group: 'Drawing' },
    { id: 'excav_microtrench', label: 'MicroTrench', group: 'Drawing' },
    { id: 'excav_direct_buried', label: 'Direct Buried', group: 'Drawing' },
    { id: 'excav_hdd', label: 'HDD', group: 'Drawing' },
    { id: 'cable_ftth', label: 'FTTH Cable', group: 'Cables' },
    { id: 'cable_lastmile', label: 'Last Mile Cabel', group: 'Cables' },
  ];

  var isToolboxManagerOpen = false;
  var enabledTools = null;
  var draftTools = null;
  var overlayEl = null;
  var listEl = null;
  var headerBound = false;

  function allToolIds() {
    return TOOL_CATALOG.map(function (t) { return t.id; });
  }

  function defaultEnabledSet() {
    var set = {};
    allToolIds().forEach(function (id) { set[id] = true; });
    return set;
  }

  function loadEnabledTools() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultEnabledSet();
      var saved = JSON.parse(raw);
      if (!saved || !Array.isArray(saved.enabled)) return defaultEnabledSet();
      var set = defaultEnabledSet();
      allToolIds().forEach(function (id) {
        set[id] = saved.enabled.indexOf(id) !== -1;
      });
      return set;
    } catch (err) {
      return defaultEnabledSet();
    }
  }

  function persistEnabledTools() {
    var enabled = allToolIds().filter(function (id) { return enabledTools[id]; });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ enabled: enabled }));
      return true;
    } catch (err) {
      return false;
    }
  }

  function cloneEnabledMap(map) {
    var copy = {};
    allToolIds().forEach(function (id) {
      copy[id] = !!map[id];
    });
    return copy;
  }

  function findToolboxElements(box, toolId) {
    if (!box) return [];
    if (toolId === 'cable_ftth' || toolId === 'cable_lastmile') {
      var groupId = toolId === 'cable_ftth' ? 'ftth' : 'lastmile';
      var cat = box.querySelector('.toolbox-category[data-category-id="cable_' + groupId + '"]');
      return cat ? [cat] : [];
    }
    var byType = box.querySelector('[data-type="' + toolId + '"]');
    if (byType) return [byType];
    var byLine = box.querySelector('[data-line-id="' + toolId + '"]');
    if (byLine) return [byLine];
    return [];
  }

  function applyFilter(box) {
    if (!box) box = document.getElementById('toolbox-items');
    if (!box || !enabledTools) return;

    TOOL_CATALOG.forEach(function (tool) {
      var show = !!enabledTools[tool.id];
      findToolboxElements(box, tool.id).forEach(function (el) {
        el.classList.toggle('toolbox-manager-hidden', !show);
      });
    });

    box.querySelectorAll('.toolbox-category').forEach(function (cat) {
      if (cat.classList.contains('toolbox-manager-hidden')) return;
      /* Cable accordions use config panels — visibility is controlled per tool above */
      if (cat.classList.contains('toolbox-category--cable')) return;
      var body = cat.querySelector('.toolbox-category__body');
      if (!body) return;
      var anyVisible = body.querySelector(
        ':scope > .toolbox-item:not(.toolbox-manager-hidden), :scope > .toolbox-category:not(.toolbox-manager-hidden)'
      );
      cat.classList.toggle('toolbox-manager-hidden', !anyVisible);
    });

    var penSection = box.querySelector('.toolbox-pen-section');
    if (penSection) {
      var penVisible = penSection.querySelector(
        '.toolbox-item:not(.toolbox-manager-hidden), .pen-line-option:not(.toolbox-manager-hidden), .toolbox-category:not(.toolbox-manager-hidden)'
      );
      penSection.classList.toggle('toolbox-manager-hidden', !penVisible);
      penSection.querySelectorAll('p').forEach(function (p) {
        if (p.textContent.trim() === 'Fiber Cables') {
          var anyCable = penSection.querySelector('.toolbox-category--cable:not(.toolbox-manager-hidden)');
          p.classList.toggle('toolbox-manager-hidden', !anyCable);
        }
        if (p.textContent.trim() === 'Excavation') {
          var anyExcav = penSection.querySelector('.pen-line-option:not(.toolbox-manager-hidden)');
          p.classList.toggle('toolbox-manager-hidden', !anyExcav);
        }
      });
    }
  }

  function syncManagerUiState() {
    var toolbox = document.getElementById('toolbox');
    var header = document.getElementById('tools-library-header');
    if (toolbox) {
      toolbox.classList.toggle('toolbox-manager-open', isToolboxManagerOpen);
    }
    if (header) {
      header.setAttribute('aria-expanded', isToolboxManagerOpen ? 'true' : 'false');
      header.classList.toggle('toolbox-header--manager-open', isToolboxManagerOpen);
    }
    if (overlayEl) {
      overlayEl.classList.toggle('toolbox-manager-overlay--open', isToolboxManagerOpen);
      overlayEl.setAttribute('aria-hidden', isToolboxManagerOpen ? 'false' : 'true');
    }
  }

  function resolveToolIconSource(toolId) {
    var box = document.getElementById('toolbox-items');
    if (!box) return null;
    var els = findToolboxElements(box, toolId);
    if (!els.length) return null;
    var root = els[0];
    if (toolId === 'cable_ftth' || toolId === 'cable_lastmile') {
      return root.querySelector('.toolbox-category__icon');
    }
    return root.querySelector('.toolbox-item__icon, .toolbox-card__icon');
  }

  function createManagerIconThumb(toolId) {
    var thumb = document.createElement('span');
    thumb.className = 'toolbox-manager-row__icon';
    thumb.setAttribute('aria-hidden', 'true');
    var sourceEl = resolveToolIconSource(toolId);
    if (sourceEl) {
      if (sourceEl.style.background) thumb.style.background = sourceEl.style.background;
      if (sourceEl.style.border) thumb.style.border = sourceEl.style.border;
      if (sourceEl.style.color) thumb.style.color = sourceEl.style.color;
      thumb.innerHTML = sourceEl.innerHTML;
    }
    return thumb;
  }

  function renderManagerList() {
    if (!listEl || !draftTools) return;
    listEl.innerHTML = '';

    var groups = {};
    TOOL_CATALOG.forEach(function (tool) {
      if (!groups[tool.group]) groups[tool.group] = [];
      groups[tool.group].push(tool);
    });

    Object.keys(groups).forEach(function (groupName) {
      var section = document.createElement('div');
      section.className = 'toolbox-manager-group';

      var title = document.createElement('p');
      title.className = 'toolbox-manager-group__title';
      title.textContent = groupName;
      section.appendChild(title);

      groups[groupName].forEach(function (tool) {
        var row = document.createElement('label');
        row.className = 'toolbox-manager-row';

        row.appendChild(createManagerIconThumb(tool.id));

        var name = document.createElement('span');
        name.className = 'toolbox-manager-row__label';
        name.textContent = tool.label;

        var switchWrap = document.createElement('span');
        switchWrap.className = 'toolbox-manager-switch';

        var input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'toolbox-manager-switch__input';
        input.checked = !!draftTools[tool.id];
        input.dataset.toolId = tool.id;
        input.addEventListener('change', function () {
          draftTools[tool.id] = input.checked;
        });

        var track = document.createElement('span');
        track.className = 'toolbox-manager-switch__track';
        track.setAttribute('aria-hidden', 'true');

        switchWrap.appendChild(input);
        switchWrap.appendChild(track);

        row.appendChild(name);
        row.appendChild(switchWrap);
        section.appendChild(row);
      });

      listEl.appendChild(section);
    });
  }

  function ensureOverlay() {
    if (overlayEl) return overlayEl;

    var host = document.getElementById('toolbox-body');
    if (!host) return null;

    overlayEl = document.createElement('div');
    overlayEl.id = 'toolbox-manager-overlay';
    overlayEl.className = 'toolbox-manager-overlay';
    overlayEl.setAttribute('aria-hidden', 'true');
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-label', 'Toolbox Library');

    overlayEl.innerHTML =
      '<div class="toolbox-manager-overlay__inner">' +
      '  <div class="toolbox-manager-overlay__header">' +
      '    <h3 class="toolbox-manager-overlay__title">Toolbox Library</h3>' +
      '    <p class="toolbox-manager-overlay__subtitle">Choose which tools appear in your library</p>' +
      '  </div>' +
      '  <div class="toolbox-manager-overlay__list"></div>' +
      '  <div class="toolbox-manager-overlay__footer">' +
      '    <button type="button" class="toolbox-manager-save-btn">Save</button>' +
      '  </div>' +
      '</div>';

    listEl = overlayEl.querySelector('.toolbox-manager-overlay__list');

    overlayEl.querySelector('.toolbox-manager-save-btn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      saveManager();
    });

    overlayEl.addEventListener('click', function (e) {
      e.stopPropagation();
    });

    host.appendChild(overlayEl);
    return overlayEl;
  }

  function openManager() {
    ensureOverlay();
    draftTools = cloneEnabledMap(enabledTools);
    renderManagerList();
    isToolboxManagerOpen = true;
    syncManagerUiState();
  }

  function closeManager() {
    isToolboxManagerOpen = false;
    draftTools = null;
    syncManagerUiState();
  }

  function toggleManager() {
    if (isToolboxManagerOpen) {
      closeManager();
    } else {
      openManager();
    }
  }

  function refreshMainToolbox() {
    if (typeof global.__renderToolboxBootstrap === 'function') {
      global.__renderToolboxBootstrap();
    }
    applyFilter();
  }

  function saveManager() {
    if (!draftTools) return;
    enabledTools = cloneEnabledMap(draftTools);
    persistEnabledTools();
    refreshMainToolbox();
    closeManager();
    showSavedToast();
  }

  function showSavedToast() {
    var old = document.getElementById('toolbox-manager-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = 'toolbox-manager-toast';
    t.setAttribute('role', 'status');
    t.className = 'toolbox-manager-toast';
    t.textContent = 'Toolbox saved';
    document.body.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 1800);
  }

  function bindRedHeader() {
    if (headerBound) return;
    var header = document.getElementById('tools-library-header');
    if (!header) return;
    headerBound = true;

    header.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      toggleManager();
    });

    header.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        toggleManager();
      }
    });
  }

  function onToolboxRendered(box) {
    applyFilter(box);
    if (isToolboxManagerOpen) {
      syncManagerUiState();
    }
  }

  function bindDom() {
    ensureOverlay();
    bindRedHeader();
    syncManagerUiState();
    applyFilter();
  }

  function init(opts) {
    enabledTools = loadEnabledTools();
    if (!opts || !opts.deferDom) {
      bindDom();
    }
  }

  global.FTTHToolboxManager = {
    init: init,
    bindDom: bindDom,
    bindRedHeader: bindRedHeader,
    onToolboxRendered: onToolboxRendered,
    applyFilter: applyFilter,
    toggleManager: toggleManager,
    isOpen: function () { return isToolboxManagerOpen; },
    getCatalog: function () { return TOOL_CATALOG.slice(); },
  };
})(typeof window !== 'undefined' ? window : globalThis);
