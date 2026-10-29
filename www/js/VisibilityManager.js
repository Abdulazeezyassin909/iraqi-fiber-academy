/**

 * FTTH Layer Visibility Manager — centralized toolbox-driven map layer toggles.

 */

(function (global) {

  'use strict';



  var state = {};

  var deps = {};

  var boundBox = null;



  var EYE_OPEN_SVG =

    '<svg class="toolbox-visibility-btn__icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +

    '<path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>' +

    '</svg>';



  var EYE_CLOSED_SVG =

    '<svg class="toolbox-visibility-btn__icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">' +

    '<path fill="currentColor" d="M12 6.5c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.53-1.26 2.8-2.89 3.65-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16c.57-.23 1.18-.36 1.83-.36zM2.71 3.16 1.29 4.58l2.46 2.46C2.73 8.61 1 11.5 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l2.76 2.76 1.42-1.42L2.71 3.16zM7.53 7.98l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z"/>' +

    '</svg>';



  var EXCAV_KIND_TO_TOOL = {

    microtrench: 'excav_microtrench',

    direct_buried: 'excav_direct_buried',

    hdd: 'excav_hdd',

  };



  function init(injected) {

    deps = injected || {};

  }



  function isVisible(toolId) {

    if (toolId == null || toolId === '') return true;

    return state[toolId] !== false;

  }



  function setVisible(toolId, visible) {

    if (!toolId) return;

    state[toolId] = visible !== false;

    syncAllVisibilityButtons();

    requestRender();

  }



  function toggle(toolId) {

    if (!toolId) return true;

    state[toolId] = !isVisible(toolId);

    syncAllVisibilityButtons();

    requestRender();

    return state[toolId];

  }



  function requestRender() {

    if (typeof deps.requestRender === 'function') deps.requestRender();

  }



  function cableCapacityToolId(kind, cap) {

    return 'cable_' + kind + '_' + cap;

  }



  function cableGroupToolId(groupId) {

    return groupId === 'lastmile' ? 'cable_lastmile' : 'cable_ftth';

  }



  function shouldSkipControls(toolId) {

    return toolId === 'splitter';

  }



  function isNodeVisible(node) {

    if (!node) return false;

    if ((node.type === 'handhole' || node.type === 'fat_handhole') && !isVisible('LM_Holes')) return false;

    if (node.type === 'handhole' && !isVisible('handhole')) return false;

    if (node.type === 'fat_handhole' && node.hasFatPole) {

      if (!isVisible('LM_Poles') || !isVisible('fat_pole')) return false;

      return true;

    }

    if (node.type === 'fat_handhole' && !isVisible('fat_handhole')) return false;

    if (node.type === 'olt' && !isVisible('olt')) return false;

    if (node.type === 'fdt' && !isVisible('fdt')) return false;

    if (node.hasClosure && (node.type === 'handhole' || node.type === 'fat_handhole') && !isVisible('closure')) {

      return false;

    }

    if (node.fatSplitter && !isVisible('splitter')) return false;

    return true;

  }



  function isCableVisible(cable) {

    if (!cable) return false;

    var kind = cable.kind || 'distribution';

    var groupId = kind === 'lastmile' ? 'lastmile' : 'ftth';

    if (!isVisible(cableGroupToolId(groupId))) return false;

    var cap = cable.capacity || 0;

    if (cap && !isVisible(cableCapacityToolId(kind, cap))) return false;

    return true;

  }



  function isExcavationVisible(path) {

    if (!path) return false;

    var kind = path.kind || 'direct_buried';

    var toolId = EXCAV_KIND_TO_TOOL[kind] || 'excav_direct_buried';

    return isVisible(toolId);

  }



  function syncVisibilityButton(btn) {

    if (!btn) return;

    var toolId = btn.dataset.toolId;

    var visible = isVisible(toolId);

    btn.innerHTML = visible ? EYE_OPEN_SVG : EYE_CLOSED_SVG;

    btn.classList.toggle('toolbox-visibility-btn--hidden', !visible);

    btn.setAttribute('aria-pressed', visible ? 'false' : 'true');

    btn.title = visible ? 'Hide on map' : 'Show on map';

  }



  function syncAllVisibilityButtons() {

    document.querySelectorAll('.toolbox-visibility-btn').forEach(syncVisibilityButton);

  }



  function createVisibilityButton(toolId, label) {

    var btn = document.createElement('button');

    btn.type = 'button';

    btn.className = 'toolbox-visibility-btn';

    btn.dataset.toolId = toolId;

    btn.setAttribute('aria-label', 'Toggle map visibility for ' + (label || toolId));

    syncVisibilityButton(btn);

    btn.addEventListener('click', function (e) {

      e.preventDefault();

      e.stopPropagation();

      e.stopImmediatePropagation();

      toggle(toolId);

    });

    return btn;

  }



  function ensureToolboxControls(el) {

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



  function appendVisibilityButton(parent, toolId, label) {

    if (!parent || !toolId || shouldSkipControls(toolId)) return;

    var controls = parent.classList.contains('toolbox-item-controls')

      ? parent

      : ensureToolboxControls(parent);

    if (!controls || controls.querySelector('.toolbox-visibility-btn[data-tool-id="' + toolId + '"]')) return;

    controls.appendChild(createVisibilityButton(toolId, label));

  }



  function unwrapLegacyVisibilityRow(el) {

    if (!el || !el.parentElement || !el.parentElement.classList.contains('toolbox-item-row')) return;

    var row = el.parentElement;

    var parent = row.parentNode;

    if (!parent) return;

    parent.insertBefore(el, row);

    row.querySelectorAll('.toolbox-visibility-btn').forEach(function (btn) { btn.remove(); });

    if (!row.childElementCount) row.remove();

  }



  function injectEyeInside(el, toolId, label) {

    if (!el || !toolId || shouldSkipControls(toolId)) return;

    unwrapLegacyVisibilityRow(el);

    appendVisibilityButton(el, toolId, label);

  }



  function injectCategoryHeaderVisibility(box) {

    box.querySelectorAll('.toolbox-category').forEach(function (cat) {

      var catId = cat.dataset.categoryId;

      if (!catId) return;

      var header = cat.querySelector(':scope > .toolbox-category__header') ||

        cat.querySelector(':scope > .toolbox-category__header-wrap > .toolbox-category__header');

      if (!header) return;



      var toolId = catId;

      if (catId.indexOf('cable_') === 0) {

        toolId = catId === 'cable_lastmile' ? 'cable_lastmile' : 'cable_ftth';

      }



      appendVisibilityButton(header, toolId, toolId);

    });

  }



  function injectToolboxItemVisibility(box) {

    box.querySelectorAll('.toolbox-item[data-type], .toolbox-card[data-type]').forEach(function (el) {

      var toolId = el.dataset.type;

      if (!toolId) return;

      var labelEl = el.querySelector('.toolbox-item__text p, .toolbox-card__title');

      injectEyeInside(el, toolId, labelEl ? labelEl.textContent.trim() : toolId);

    });

  }



  function injectPenLineVisibility(box) {

    box.querySelectorAll('.pen-line-option[data-line-id]').forEach(function (el) {

      var toolId = el.dataset.lineId;

      if (!toolId) return;

      injectEyeInside(el, toolId, el.textContent.trim());

    });

  }



  function ensureChipVisibilityFrame(chip) {

    var wrap = chip.closest('.cable-cap-chip-wrap');

    if (!wrap) {

      wrap = document.createElement('div');

      wrap.className = 'cable-cap-chip-wrap';

      chip.parentNode.insertBefore(wrap, chip);

      wrap.appendChild(chip);

    }

    return wrap;

  }



  function injectCableCapacityVisibility(box) {

    box.querySelectorAll('.cable-cap-chip').forEach(function (chip) {

      var kind = chip.dataset.cableCap;

      var cap = chip.dataset.cap;

      if (!kind || !cap) return;

      var wrap = ensureChipVisibilityFrame(chip);

      appendVisibilityButton(wrap, cableCapacityToolId(kind, cap), cap + 'F');

    });

  }



  function injectVisibilityButtons(box) {

    if (!box) return;

    injectCategoryHeaderVisibility(box);

    injectToolboxItemVisibility(box);

    injectPenLineVisibility(box);

    injectCableCapacityVisibility(box);

    syncAllVisibilityButtons();

  }



  function bindToolbox(box) {

    if (!box) return;

    injectVisibilityButtons(box);

    boundBox = box;

  }



  global.FTTHVisibilityManager = {

    init: init,

    bindToolbox: bindToolbox,

    isVisible: isVisible,

    setVisible: setVisible,

    toggle: toggle,

    isNodeVisible: isNodeVisible,

    isCableVisible: isCableVisible,

    isExcavationVisible: isExcavationVisible,

    injectVisibilityButtons: injectVisibilityButtons,

    createVisibilityButton: createVisibilityButton,

    syncAllVisibilityButtons: syncAllVisibilityButtons,

    ensureToolboxControls: ensureToolboxControls,

  };

})(typeof window !== 'undefined' ? window : globalThis);


