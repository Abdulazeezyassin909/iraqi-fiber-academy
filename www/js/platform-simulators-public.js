/**
 * Public homepage: render simulator cards from PlatformSimulators catalog (Firestore-backed meta).
 */
(function () {
  'use strict';

  var GRID_ID = 'publicSimulatorsGrid';
  var lastSignature = '';

  var EXTRA_CARD_ATTRS = {
    'fusion-splicer': 'data-fusion-splicer-card',
    'fiber-anatomy': 'data-anatomy-simulator-card',
    'patch-panel-lab': 'data-ftth-lab-card',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function catalogSignature(catalog) {
    return catalog
      .map(function (sim) {
        return [sim.id, sim.label, sim.description, sim.icon, sim.iconType, sim.href].join(':');
      })
      .join('|');
  }

  function buildCardIconHtml(sim) {
    if (window.PlatformSimulators && typeof window.PlatformSimulators.iconHtml === 'function') {
      return window.PlatformSimulators.iconHtml({
        icon: sim.icon,
        iconType: sim.iconType,
      });
    }
    return escapeHtml(sim.icon || '◆');
  }

  function revealSimulatorCards(grid) {
    if (!grid) return;
    if (typeof window.reobserveAnimations === 'function') {
      window.reobserveAnimations(grid);
    }
    grid.querySelectorAll('.feature-card').forEach(function (card) {
      card.classList.add('visible');
    });
  }

  function buildCardHtml(sim) {
    var extraAttr = EXTRA_CARD_ATTRS[sim.id] ? ' ' + EXTRA_CARD_ATTRS[sim.id] : '';
    return (
      '<article class="feature-card fade-in" data-simulator-card data-simulator-id="' +
      escapeHtml(sim.id) +
      '" data-simulator-href="' +
      escapeHtml(sim.href || '') +
      '"' +
      extraAttr +
      '>' +
      '<div class="feature-card__icon">' +
      buildCardIconHtml(sim) +
      '</div>' +
      '<h3 class="feature-card__title">' +
      escapeHtml(sim.label) +
      '</h3>' +
      '<p class="feature-card__desc">' +
      escapeHtml(sim.description || '') +
      '</p>' +
      '<div class="feature-card__access" data-simulator-access></div>' +
      '</article>'
    );
  }

  function renderPublicSimulatorsGrid(force) {
    var grid = document.getElementById(GRID_ID);
    if (!grid || !window.PlatformSimulators) return;

    var catalog = window.PlatformSimulators.getCatalog();
    var signature = catalogSignature(catalog);
    if (!force && signature === lastSignature) {
      if (typeof window.PlatformSimulators.applyPublicSimulatorGates === 'function') {
        window.PlatformSimulators.applyPublicSimulatorGates();
      }
      revealSimulatorCards(grid);
      return;
    }

    lastSignature = signature;
    grid.innerHTML = catalog.map(buildCardHtml).join('');

    if (typeof window.PlatformSimulators.applyPublicSimulatorGates === 'function') {
      window.PlatformSimulators.applyPublicSimulatorGates();
    }
    revealSimulatorCards(grid);
  }

  function refreshPublicSimulators() {
    renderPublicSimulatorsGrid(true);
    if (
      window.PlatformSimulatorShowcase &&
      typeof window.PlatformSimulatorShowcase.mountSimulatorShowcase === 'function'
    ) {
      window.PlatformSimulatorShowcase.mountSimulatorShowcase();
    }
  }

  window.renderPublicSimulatorsGrid = renderPublicSimulatorsGrid;
  window.refreshPublicSimulators = refreshPublicSimulators;
})();
