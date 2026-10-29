/**
 * Fiber Optics 3D/2D Interactive Anatomy
 * Hierarchical click-to-peel: Jacket → Loose Tubes → Strands
 * Last Mile: 12F / 24F / 36F / 48F (6 strands / tube)
 * FTTH Cable: 48F Feeder / 72F / 144F / 288F (12 strands / tube)
 */
(function () {
  'use strict';

  var COLOR = {
    Blue: { name: 'Blue', hex: '#2563eb' },
    Orange: { name: 'Orange', hex: '#f97316' },
    Green: { name: 'Green', hex: '#22c55e' },
    Brown: { name: 'Brown', hex: '#a16207' },
    Slate: { name: 'Slate/Grey', hex: '#64748b' },
    White: { name: 'White', hex: '#f8fafc' },
    Red: { name: 'Red', hex: '#ef4444' },
    Black: { name: 'Black', hex: '#1e293b' },
    Yellow: { name: 'Yellow', hex: '#eab308' },
    Violet: { name: 'Violet', hex: '#a855f7' },
    Rose: { name: 'Rose', hex: '#f472b6' },
    Aqua: { name: 'Sky Blue', hex: '#22d3ee' },
  };

  /* Full TIA-598 12-color sequence (tubes & high-capacity strands) */
  var COLOR_ORDER_12 = [
    'Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White',
    'Red', 'Black', 'Yellow', 'Violet', 'Rose', 'Aqua',
  ];

  var STRAND_ORDER_6 = COLOR_ORDER_12.slice(0, 6);
  var STRAND_ORDER_12 = COLOR_ORDER_12.slice();

  function tubesFromCount(count) {
    return COLOR_ORDER_12.slice(0, count);
  }

  function tubes288DualGroup() {
    return COLOR_ORDER_12.concat(COLOR_ORDER_12);
  }

  var CABLE_SPECS = {
    12: {
      capacity: 12,
      label: '12F',
      badge: '12F',
      category: 'lastmile',
      strandsPerTube: 6,
      tubes: tubesFromCount(2),
    },
    24: {
      capacity: 24,
      label: '24F',
      badge: '24F',
      category: 'lastmile',
      strandsPerTube: 6,
      tubes: tubesFromCount(4),
    },
    36: {
      capacity: 36,
      label: '36F',
      badge: '36F',
      category: 'lastmile',
      strandsPerTube: 6,
      tubes: tubesFromCount(6),
    },
    '48lm': {
      capacity: 48,
      label: '48F [Last Mile]',
      badge: '48F',
      category: 'lastmile',
      strandsPerTube: 6,
      tubes: tubesFromCount(8),
    },
    '48f': {
      capacity: 48,
      label: '48F [Feeder]',
      badge: '48F',
      category: 'ftth',
      strandsPerTube: 12,
      tubes: tubesFromCount(4),
    },
    72: {
      capacity: 72,
      label: '72F',
      badge: '72F',
      category: 'ftth',
      strandsPerTube: 12,
      tubes: tubesFromCount(6),
    },
    144: {
      capacity: 144,
      label: '144F',
      badge: '144F',
      category: 'ftth',
      strandsPerTube: 12,
      tubes: tubesFromCount(12),
    },
    288: {
      capacity: 288,
      label: '288F',
      badge: '288F',
      category: 'ftth',
      strandsPerTube: 12,
      dualGroup: true,
      tubes: tubes288DualGroup(),
    },
  };

  var COMPONENTS = {
    cable: {
      id: 'cable',
      title: 'Fiber Cable Anatomy',
      desc: 'Click the jacket to peel tubes, then click a tube to reveal its standard-color strands.',
    },
    fdt: {
      id: 'fdt',
      title: 'FDT Cabinet',
      desc: 'Fiber Distribution Terminal anatomy: trays, ports, and splitter bays.',
    },
    splitter: {
      id: 'splitter',
      title: 'Optical Splitter',
      desc: 'Passive PLC splitter with input and fan-out outputs.',
    },
    olt: {
      id: 'olt',
      title: 'OLT Line Card',
      desc: 'Optical Line Terminal shelf with PON ports and indicators.',
    },
  };

  var CATEGORIES = [];

  function escapeRail(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isCustomIconSrc(icon) {
    if (!icon) return false;
    return icon.indexOf('data:image') === 0 ||
      icon.indexOf('http://') === 0 ||
      icon.indexOf('https://') === 0 ||
      icon.indexOf('/') === 0;
  }

  function railIconHtml(icon) {
    if (isCustomIconSrc(icon)) {
      return '<img class="f3d-component-btn__icon-img" alt="" src="' + escapeRail(icon) + '">';
    }
    return '<span class="f3d-component-btn__icon" aria-hidden="true">' + escapeRail(icon || '🧬') + '</span>';
  }

  function tubesForCount(count, dualGroup) {
    if (dualGroup) return tubes288DualGroup();
    var n = Math.max(1, count || 2);
    var tubes = [];
    var i;
    for (i = 0; i < n; i++) tubes.push(COLOR_ORDER_12[i % 12]);
    return tubes;
  }

  function applyAnatomyConfigFromStore() {
    var cfg = window.FiberAnatomyStore
      ? window.FiberAnatomyStore.getActiveConfig()
      : (window.FACTORY_DEFAULT_ANATOMY_CONFIG || null);
    if (!cfg) return;
    var specs = {};
    var components = {
      cable: {
        id: 'cable',
        title: 'Fiber Cable Anatomy',
        desc: 'Click the jacket to peel tubes, then click a tube to reveal its standard-color strands.',
      },
    };
    (cfg.items || []).forEach(function (item) {
      if (item.kind === 'component') {
        components[item.id] = {
          id: item.id,
          title: item.guideTitle || item.label,
          desc: item.guideText || item.sublabel || '',
          media3D: item.media3D,
          media2D: item.media2D,
          variants: item.variants || [],
          activeVariantId: item.activeVariantId || '',
          icon: item.icon,
          sublabel: item.sublabel,
          categoryId: item.categoryId,
        };
        return;
      }
      specs[item.id] = {
        capacity: item.capacity,
        label: item.label,
        badge: item.badge || item.label,
        category: item.categoryId,
        strandsPerTube: item.strandsPerTube,
        dualGroup: !!item.dualGroup,
        tubes: tubesForCount(item.tubeCount, item.dualGroup),
        sublabel: item.sublabel,
        guideTitle: item.guideTitle,
        guideText: item.guideText,
        media3D: item.media3D,
        media2D: item.media2D,
        icon: item.icon,
      };
    });
    CABLE_SPECS = specs;
    COMPONENTS = components;
    CATEGORIES = cfg.categories || [];
    if (state.component === 'cable') {
      var key = resolveCapacityKey(state.capacity);
      if (key == null) {
        var firstKey = Object.keys(CABLE_SPECS)[0];
        if (firstKey) state.capacity = firstKey;
      }
    } else if (!COMPONENTS[state.component]) {
      state.component = 'cable';
    }
  }

  function renderCableRail() {
    var rail = $('f3d-rail');
    if (!rail) return;
    var html = '';
    var cats = CATEGORIES.length ? CATEGORIES : [
      { id: 'lastmile', label: 'Last Mile Cable' },
      { id: 'ftth', label: 'FTTH Cable' },
      { id: 'other', label: 'Other Components' },
    ];
    cats.forEach(function (cat, idx) {
      html += '<p class="f3d-rail__label"' + (idx ? ' style="margin-top:1rem"' : '') + '>' +
        escapeRail(cat.label) + '</p><ul class="f3d-component-list">';
      if (cat.id === 'other') {
        Object.keys(COMPONENTS).forEach(function (id) {
          if (id === 'cable') return;
          var comp = COMPONENTS[id];
          if (comp.categoryId && comp.categoryId !== cat.id) return;
          html += '<li><button type="button" class="f3d-component-btn" data-f3d-component="' +
            escapeRail(id) + '">' + railIconHtml(comp.icon) +
            '<span class="f3d-component-btn__text"><strong>' +
            escapeRail(comp.title) + '</strong><span>' + escapeRail(comp.sublabel || '') +
            '</span></span></button></li>';
        });
      } else {
        Object.keys(CABLE_SPECS).forEach(function (key) {
          var spec = CABLE_SPECS[key];
          if (spec.category !== cat.id) return;
          html += '<li><button type="button" class="f3d-component-btn" data-f3d-capacity="' +
            escapeRail(key) + '">' + railIconHtml(spec.icon) +
            '<span class="f3d-component-btn__text"><strong>' +
            escapeRail(spec.label) + '</strong><span>' + escapeRail(spec.sublabel || '') +
            '</span></span></button></li>';
        });
      }
      html += '</ul>';
    });
    rail.innerHTML = html;
    syncComponentButtons();
  }

  var state = {
    component: 'cable',
    capacity: 12,
    peelState: 0, /* 0 jacket, 1 tubes, 2 strands */
    selectedTube: null,
    viewMode: '3d', /* 3d | 2d */
    autoRotate: true,
    scene: null,
    camera: null,
    renderer: null,
    root: null,
    raycaster: null,
    pointer: null,
    jacketMesh: null,
    coreMesh: null,
    tubeGroups: [],
    tubeMeshes: [],
    strandMeshes: [],
    propMeshes: [],
    layout3d: null,
    drag: null,
    raf: 0,
    activeVariantId: null,
  };

  /* Base concentric cable layout (scaled per tube count in resolveLayout3d) */
  var CABLE_3D = {
    jacketLen: 4.4,
    jacketOpenLen: 2.15,
    coreLen: 4.55,
    tubeLen: 3.85,
    strandLen: 3.35,
  };

  function $(id) { return document.getElementById(id); }

  function getSpec() {
    return CABLE_SPECS[state.capacity] || CABLE_SPECS[12];
  }

  function resolveCapacityKey(cap) {
    if (cap == null) return null;
    if (Object.prototype.hasOwnProperty.call(CABLE_SPECS, cap)) return cap;
    var asStr = String(cap);
    if (Object.prototype.hasOwnProperty.call(CABLE_SPECS, asStr)) return asStr;
    var n = parseInt(asStr, 10);
    if (!isNaN(n) && Object.prototype.hasOwnProperty.call(CABLE_SPECS, n)) return n;
    return null;
  }

  function jacketBadge(spec) {
    return (spec && (spec.badge || spec.label)) || '';
  }

  function colorOf(key) {
    return COLOR[key] || COLOR.Blue;
  }

  function getStrandOrder(spec) {
    var n = (spec && spec.strandsPerTube) || 12;
    return n <= 6 ? STRAND_ORDER_6 : STRAND_ORDER_12;
  }

  function isTubeStriped(spec, tubeIndex) {
    return !!(spec && spec.dualGroup && tubeIndex >= 12);
  }

  function resolveLayout3d(tubeCount) {
    var n = Math.max(tubeCount || 4, 1);
    if (n <= 4) {
      return {
        jacketR: 1.05, coreR: 0.2, bufferR: 0.3, tubeR: 0.175, strandR: 0.022,
        ringClosed: 0.56, ringOpen: 0.64, ringExpand: 0.72,
        ring2Closed: 0, ring2Open: 0, ring2Expand: 0, dualRing: false,
        strandLocalR: 0.075,
      };
    }
    if (n <= 6) {
      return {
        jacketR: 1.18, coreR: 0.2, bufferR: 0.3, tubeR: 0.15, strandR: 0.02,
        ringClosed: 0.62, ringOpen: 0.7, ringExpand: 0.78,
        ring2Closed: 0, ring2Open: 0, ring2Expand: 0, dualRing: false,
        strandLocalR: 0.065,
      };
    }
    if (n <= 12) {
      return {
        jacketR: 1.48, coreR: 0.22, bufferR: 0.34, tubeR: 0.115, strandR: 0.015,
        ringClosed: 0.88, ringOpen: 0.96, ringExpand: 1.05,
        ring2Closed: 0, ring2Open: 0, ring2Expand: 0, dualRing: false,
        strandLocalR: 0.05,
      };
    }
    /* 288F — dual concentric rings (T1–T12 inner, T13–T24 outer) */
    return {
      jacketR: 1.85, coreR: 0.24, bufferR: 0.36, tubeR: 0.095, strandR: 0.012,
      ringClosed: 0.72, ringOpen: 0.78, ringExpand: 0.84,
      ring2Closed: 1.22, ring2Open: 1.32, ring2Expand: 1.42, dualRing: true,
      strandLocalR: 0.042,
    };
  }

  function tubeRingRadius(layout, peel, tubeIndex) {
    var dual = layout.dualRing;
    var outer = dual && tubeIndex >= 12;
    if (peel === 0) return outer ? layout.ring2Closed : layout.ringClosed;
    if (peel === 1) return outer ? layout.ring2Open : layout.ringOpen;
    return outer ? layout.ring2Expand : layout.ringExpand;
  }

  function tubeAngle(n, tubeIndex, dualRing) {
    if (dualRing) {
      var local = tubeIndex % 12;
      return (local / 12) * Math.PI * 2 - Math.PI / 2;
    }
    return (tubeIndex / Math.max(n, 1)) * Math.PI * 2 - Math.PI / 2;
  }

  function setStatus(msg) {
    var el = $('f3d-status');
    if (el) el.textContent = msg || '';
  }

  function clearMeshList(list) {
    (list || []).forEach(function (m) {
      if (!m) return;
      if (m.parent) m.parent.remove(m);
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        if (Array.isArray(m.material)) m.material.forEach(function (mat) { mat.dispose(); });
        else m.material.dispose();
      }
    });
  }

  function disposeCableMeshes() {
    (state.tubeGroups || []).forEach(function (group) {
      while (group.children.length) {
        var ch = group.children[0];
        group.remove(ch);
        if (ch.geometry) ch.geometry.dispose();
        if (ch.material) {
          if (Array.isArray(ch.material)) ch.material.forEach(function (m) { m.dispose(); });
          else ch.material.dispose();
        }
      }
      if (group.parent) group.parent.remove(group);
    });
    state.tubeGroups = [];
    state.tubeMeshes = [];
    state.strandMeshes = [];
    clearMeshList([state.jacketMesh].concat(state.propMeshes));
    state.jacketMesh = null;
    state.coreMesh = null;
    state.propMeshes = [];
  }

  /* ─── Inspector / 2D technical layout ─── */

  function renderInspector() {
    var card = $('f3d-inspector-card');
    var stack = $('f3d-layer-stack');
    var fibers = $('f3d-fiber-grid');
    if (!card || !stack) return;

    var comp = COMPONENTS[state.component] || COMPONENTS.cable;
    var spec = getSpec();
    var strands = getStrandOrder(spec);
    var sp = spec.strandsPerTube || strands.length;

    if (state.component === 'cable') {
      var peelLabel = state.peelState === 0
        ? 'State 1 · Full cable (outer jacket)'
        : state.peelState === 1
          ? 'State 2 · Loose tubes (' + spec.tubes.length + ' × ' + sp + 'F)'
          : 'State 3 · Tube ' + (state.selectedTube + 1) + ' · ' + sp + ' strands';
      card.innerHTML =
        '<h2>' + escapeRail(spec.guideTitle || (spec.label + ' Cable Anatomy')) + '</h2>' +
        '<p>' + escapeRail(spec.guideText || comp.desc) + '</p>' +
        (spec.dualGroup
          ? '<p class="f3d-inspector__state">Tubes 13–24 · mid black stripe marker</p>'
          : '') +
        '<p class="f3d-inspector__state">' + peelLabel + '</p>';
    } else {
      var entity = getActiveEntity();
      card.innerHTML = '<h2>' + escapeRail((entity && entity.guideTitle) || comp.title || '') +
        '</h2><p>' + escapeRail((entity && (entity.guideText || entity.desc)) || comp.desc || '') + '</p>';
    }

    stack.innerHTML = '';
    if (state.component === 'cable') {
      spec.tubes.forEach(function (tubeKey, idx) {
        var c = colorOf(tubeKey);
        var striped = isTubeStriped(spec, idx);
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'f3d-layer-row f3d-layer-row--btn' +
          (state.peelState >= 1 && state.selectedTube === idx ? ' is-active' : '') +
          (state.peelState === 0 ? ' is-dim' : '');
        row.innerHTML =
          '<span class="f3d-swatch' + (striped ? ' f3d-swatch--striped' : '') +
          '" style="background:' + c.hex + '"></span>' +
          '<span>T' + (idx + 1) + ' · ' + c.name + ' · ' + sp + 'F</span>';
        row.addEventListener('click', function () {
          if (state.peelState === 0) peelToTubes();
          openTubeStrands(idx);
        });
        stack.appendChild(row);
      });
    }

    if (fibers) {
      fibers.innerHTML = '';
      if (state.component === 'cable' && state.peelState === 2 && state.selectedTube != null) {
        var tubeKey = spec.tubes[state.selectedTube];
        strands.forEach(function (key, i) {
          var c = colorOf(key);
          var chip = document.createElement('div');
          chip.className = 'f3d-fiber-chip';
          chip.innerHTML =
            '<span class="f3d-swatch" style="background:' + c.hex + '"></span>' +
            '<span>' + (i + 1) + ' · ' + c.name + '</span>';
          fibers.appendChild(chip);
        });
        fibers.hidden = false;
        fibers.classList.toggle('f3d-fiber-grid--12', sp >= 12);
        var cap = $('f3d-fiber-caption');
        if (cap) {
          cap.hidden = false;
          cap.textContent = 'T' + (state.selectedTube + 1) + ' (' + colorOf(tubeKey).name +
            ') · ' + sp + ' strands';
        }
      } else {
        fibers.hidden = true;
        fibers.classList.remove('f3d-fiber-grid--12');
        var capEl = $('f3d-fiber-caption');
        if (capEl) capEl.hidden = true;
      }
    }

    syncCableUiChrome();
    render2dLayout();
  }

  function render2dLayout() {
    var host = $('f3d-2d-host');
    if (!host) return;
    hideMediaOverlay();
    if (state.viewMode !== '2d') {
      host.innerHTML = '';
      return;
    }

    var entity = getActiveEntity();
    var media2D = entity && entity.media2D;
    if (media2D && media2D.type === 'custom-media' && media2D.data) {
      host.innerHTML = '';
      var wrap = document.createElement('div');
      wrap.className = 'f3d-2d-custom';
      var isVideo = media2D.data.indexOf('data:video') === 0 || /\.mp4(\?|$)/i.test(media2D.data);
      if (isVideo) {
        var vid = document.createElement('video');
        vid.controls = true;
        vid.src = media2D.data;
        wrap.appendChild(vid);
      } else {
        var img = document.createElement('img');
        img.alt = (entity.label || entity.title || 'Schematic') + '';
        img.src = media2D.data;
        wrap.appendChild(img);
      }
      host.appendChild(wrap);
      return;
    }

    if (state.component !== 'cable') {
      host.innerHTML = '<p class="f3d-2d-empty">2D technical layout is available for Fiber Cable. Select a capacity (12F–288F).</p>';
      return;
    }

    var spec = getSpec();
    var strands = getStrandOrder(spec);
    var sp = spec.strandsPerTube || strands.length;
    var tubeCount = spec.tubes.length;
    var step = state.peelState === 0 ? 1 : state.peelState === 1 ? 2 : 3;
    var blockH = tubeCount >= 24 ? 360 : tubeCount >= 12 ? 300 : 224;
    var html = '<div class="f3d-2d-sheet" data-f3d-2d-step="' + step + '">';

    html += '<div class="f3d-2d-steps" aria-label="Dissection steps">' +
      '<span class="f3d-2d-step' + (step === 1 ? ' is-current' : step > 1 ? ' is-done' : '') + '">1 · Jacket</span>' +
      '<span class="f3d-2d-step' + (step === 2 ? ' is-current' : step > 2 ? ' is-done' : '') + '">2 · Tubes</span>' +
      '<span class="f3d-2d-step' + (step === 3 ? ' is-current' : '') + '">3 · Strands</span>' +
      '</div>';

    html += '<div class="f3d-2d-title">' + spec.label + ' Technical Layout</div>';
    html += '<p class="f3d-2d-subtitle">Layer-by-layer · ' + tubeCount +
      ' tubes × ' + sp + ' strands' +
      (spec.dualGroup ? ' · T13–T24 mid-stripe markers' : '') +
      ' · left → right</p>';

    html += '<div class="f3d-schematic' + (tubeCount >= 12 ? ' f3d-schematic--dense' : '') +
      '" style="--tube-count:' + tubeCount + ';--schematic-h:' + blockH + 'px">';

    if (state.peelState === 0) {
      html += '<button type="button" class="f3d-schematic__row f3d-schematic__row--closed" ' +
        'data-f3d-2d-peel="jacket" title="Click jacket to expose loose tubes" ' +
        'aria-label="' + spec.label + ' outer jacket — click to peel">' +
        '<span class="f3d-layer-jacket">' +
        '<span class="f3d-layer-jacket__label">' + jacketBadge(spec) + '</span>' +
        '</span>' +
        '<span class="f3d-schematic__hint">Click jacket → expose tubes</span>' +
        '</button>';
    } else {
      html += '<div class="f3d-schematic__row f3d-schematic__row--tubes" aria-label="Jacket and loose tubes">';
      html += '<div class="f3d-layer-jacket f3d-layer-jacket--open" title="Outer jacket">' +
        '<span class="f3d-layer-jacket__label">' + jacketBadge(spec) + '</span>' +
        '</div>';
      html += '<div class="f3d-tube-ribbon" role="list">';
      spec.tubes.forEach(function (tubeKey, ti) {
        var tc = colorOf(tubeKey);
        var sel = state.peelState === 2 && state.selectedTube === ti;
        var striped = isTubeStriped(spec, ti);
        html += '<button type="button" class="f3d-tube-bar' +
          (sel ? ' is-selected' : '') +
          (striped ? ' is-striped' : '') + '" ' +
          'role="listitem" data-f3d-2d-tube="' + ti + '" ' +
          'style="--tube-color:' + tc.hex + '" ' +
          'title="T' + (ti + 1) + ' · ' + tc.name +
          (striped ? ' · mid stripe' : '') +
          ' — click for ' + sp + ' strands" ' +
          'aria-pressed="' + (sel ? 'true' : 'false') + '">' +
          '<span class="f3d-tube-bar__fill"></span>' +
          '<span class="f3d-tube-bar__stripe" aria-hidden="true"></span>' +
          '<span class="f3d-tube-bar__name">T' + (ti + 1) + '</span>' +
          '</button>';
      });
      html += '</div></div>';

      if (state.peelState === 2 && state.selectedTube != null) {
        var tk = spec.tubes[state.selectedTube];
        var tcSel = colorOf(tk);
        var selStriped = isTubeStriped(spec, state.selectedTube);
        html += '<div class="f3d-schematic__row f3d-schematic__row--strands" ' +
          'aria-label="Tube ' + (state.selectedTube + 1) + ' fiber strands">' +
          '<div class="f3d-layer-tube' + (selStriped ? ' is-striped' : '') +
          '" style="--tube-color:' + tcSel.hex + '">' +
          '<span class="f3d-layer-tube__stripe" aria-hidden="true"></span>' +
          '<span class="f3d-layer-tube__label">T' + (state.selectedTube + 1) + '</span>' +
          '</div>' +
          '<div class="f3d-strand-ribbon f3d-strand-ribbon--' + sp + '" role="list">';
        strands.forEach(function (sk, si) {
          var sc = colorOf(sk);
          html += '<div class="f3d-strand-line" role="listitem" ' +
            'style="--strand-color:' + sc.hex + '" title="F' + (si + 1) + ' · ' + sc.name + '">' +
            '<span class="f3d-strand-line__fill"></span>' +
            '</div>';
        });
        html += '</div>' +
          '<div class="f3d-strand-legend f3d-strand-legend--' + sp + '">';
        strands.forEach(function (sk, si) {
          var sc = colorOf(sk);
          html += '<span class="f3d-strand-legend__item">' +
            '<i style="background:' + sc.hex + '"></i>F' + (si + 1) + ' ' + sc.name + '</span>';
        });
        html += '</div></div>';
      } else {
        html += '<p class="f3d-schematic__hint f3d-schematic__hint--below">Click a tube bar → ' +
          sp + ' strands</p>';
      }
    }

    html += '</div>';

    if (state.peelState > 0) {
      html += '<button type="button" class="f3d-2d-reset" data-f3d-2d-reset="1">← Reset to Full Jacket</button>';
    }

    html += '</div>';
    host.innerHTML = html;

    var peelBtn = host.querySelector('[data-f3d-2d-peel="jacket"]');
    if (peelBtn) peelBtn.addEventListener('click', peelToTubes);
    host.querySelectorAll('[data-f3d-2d-tube]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        openTubeStrands(parseInt(btn.getAttribute('data-f3d-2d-tube'), 10));
      });
    });
    var reset = host.querySelector('[data-f3d-2d-reset]');
    if (reset) reset.addEventListener('click', resetPeel);
  }

  /* ─── Peel state machine ─── */

  function resetPeel() {
    if (state.component !== 'cable') return;
    state.peelState = 0;
    state.selectedTube = null;
    applyPeelVisibility();
    renderInspector();
    setStatus(getSpec().label + ' · Full cable jacket — click to peel tubes');
  }

  function resetTube() {
    if (state.component !== 'cable') return;
    if (state.peelState < 1) {
      setStatus(getSpec().label + ' · Peel the jacket first to expose tubes');
      return;
    }
    state.peelState = 1;
    state.selectedTube = null;
    applyPeelVisibility();
    renderInspector();
    var sp = getSpec().strandsPerTube || 12;
    setStatus(getSpec().label + ' · Loose tubes restored — click a tube for ' + sp + ' strands');
  }

  function syncCableUiChrome() {
    var isCable = state.component === 'cable';
    var app = $('f3d-app');
    if (app) {
      app.classList.toggle('is-cable', isCable);
      app.classList.toggle('is-hardware', !isCable);
    }
    var jacketBtn = $('btn-reset-jacket') || $('f3d-reset-peel');
    var tubeBtn = $('btn-reset-tube');
    var tubesWrap = $('f3d-loose-tubes');
    var display = isCable ? 'inline-flex' : 'none';
    if (jacketBtn) jacketBtn.style.display = display;
    if (tubeBtn) tubeBtn.style.display = display;
    if (tubesWrap) {
      tubesWrap.hidden = !isCable;
      tubesWrap.style.display = isCable ? '' : 'none';
    }
    renderVariantPills();
  }

  function isDisplayableVariant(variant) {
    if (!variant || typeof variant !== 'object') return false;
    var label = String(variant.label || '').trim();
    if (!label) return false;
    if (label === 'New Variant' || label === 'Variant') return false;
    return true;
  }

  function renderVariantPills() {
    var host = $('f3d-variant-pills');
    if (!host) return;
    host.innerHTML = '';
    var activeItem = state.component === 'cable' ? null : COMPONENTS[state.component];
    var hasVariants = activeItem && Array.isArray(activeItem.variants) && activeItem.variants.length > 0;
    var variants = hasVariants ? activeItem.variants.filter(isDisplayableVariant) : [];
    if (state.component === 'cable' || !hasVariants || !variants.length) {
      host.hidden = true;
      host.style.display = 'none';
      return;
    }
    host.hidden = false;
    host.style.display = 'flex';
    variants.forEach(function (variant) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'f3d-variant-pill' +
        (variant.id === state.activeVariantId ? ' active is-active' : '');
      btn.setAttribute('data-f3d-variant', variant.id);
      btn.textContent = variant.label;
      host.appendChild(btn);
    });
  }

  function setActiveHardwareVariant(variantId) {
    var comp = COMPONENTS[state.component];
    if (!comp || !comp.variants) return;
    var found = comp.variants.filter(function (v) { return v.id === variantId; })[0];
    if (!found) return;
    state.activeVariantId = variantId;
    comp.activeVariantId = variantId;
    if (window.FiberAnatomyStore && typeof window.FiberAnatomyStore.setActiveVariant === 'function') {
      window.FiberAnatomyStore.setActiveVariant(state.component, variantId, true);
    }
    rebuildSceneContent();
    renderInspector();
    setStatus((comp.title || '') + ' · ' + found.label);
  }

  function peelToTubes() {
    if (state.component !== 'cable') return;
    state.peelState = 1;
    state.selectedTube = null;
    applyPeelVisibility();
    renderInspector();
    var sp = getSpec().strandsPerTube || 12;
    setStatus(getSpec().label + ' · Loose tubes exposed — click a tube for ' + sp + ' strands');
  }

  function openTubeStrands(tubeIndex) {
    if (state.component !== 'cable') return;
    var spec = getSpec();
    if (tubeIndex < 0 || tubeIndex >= spec.tubes.length) return;
    state.peelState = 2;
    state.selectedTube = tubeIndex;
    applyPeelVisibility();
    renderInspector();
    var t = colorOf(spec.tubes[tubeIndex]);
    var sp = spec.strandsPerTube || 12;
    setStatus(getSpec().label + ' · T' + (tubeIndex + 1) + ' (' + t.name + ') · ' + sp + ' strands');
  }

  function applyPeelVisibility() {
    if (state.component !== 'cable') return;
    var peel = state.peelState;
    var cfg = CABLE_3D;
    var layout = state.layout3d || resolveLayout3d(getSpec().tubes.length);
    var n = Math.max(getSpec().tubes.length, 1);

    if (state.jacketMesh && state.jacketMesh.material) {
      state.jacketMesh.visible = true;
      state.jacketMesh.material.transparent = false;
      state.jacketMesh.material.opacity = 1;
      if (peel === 0) {
        state.jacketMesh.scale.set(1, 1, 1);
        state.jacketMesh.position.x = 0;
      } else {
        var openScale = cfg.jacketOpenLen / cfg.jacketLen;
        state.jacketMesh.scale.set(1, openScale, 1);
        state.jacketMesh.position.x = -(cfg.jacketLen - cfg.jacketOpenLen) / 2;
      }
    }

    state.propMeshes.forEach(function (m) {
      if (!m) return;
      if (m.userData && (m.userData.kind === 'core' || m.userData.kind === 'coreBuffer')) {
        m.visible = peel >= 1;
        m.position.x = peel >= 1 ? 0.2 : 0;
      }
    });

    var tubeShiftX = peel === 0 ? 0 : peel === 1 ? 0.45 : 0.55;

    (state.tubeGroups || []).forEach(function (group, i) {
      if (!group) return;
      var angle = tubeAngle(n, i, layout.dualRing);
      var ringR = tubeRingRadius(layout, peel, i);
      group.visible = peel >= 1;
      group.position.set(tubeShiftX, Math.cos(angle) * ringR, Math.sin(angle) * ringR);

      var tube = state.tubeMeshes[i];
      var selected = peel === 2 && state.selectedTube === i;
      if (tube && tube.material) {
        tube.visible = peel >= 1;
        tube.material.transparent = peel === 2;
        tube.material.opacity = peel === 2 ? (selected ? 0.55 : 0.28) : 1;
        tube.scale.set(selected ? 1.08 : 1, selected ? 1.05 : 1, selected ? 1.08 : 1);
      }
    });

    var strandCount = getStrandOrder(getSpec()).length;
    state.strandMeshes.forEach(function (fiber) {
      if (!fiber) return;
      var tid = fiber.userData.tubeIndex;
      var show = peel === 2 && state.selectedTube === tid;
      fiber.visible = show;
      if (!show) return;
      var a = fiber.userData.localA;
      var baseR = fiber.userData.localR || layout.strandLocalR || 0.05;
      var fanR = baseR * (strandCount >= 12 ? 1.7 : 1.55);
      fiber.position.set(0.85, Math.cos(a) * fanR, Math.sin(a) * fanR);
      fiber.scale.set(1, 1.35, 1);
    });
  }

  /* ─── 3D builders ─── */

  function getActiveEntity() {
    if (state.component === 'cable') return getSpec();
    var base = COMPONENTS[state.component];
    if (!base) return base;
    var variants = base.variants || [];
    var variant = null;
    if (variants.length) {
      variant = variants.filter(function (v) { return v.id === state.activeVariantId; })[0] || variants[0];
    }
    if (!variant) return base;
    return {
      id: base.id,
      title: base.title,
      label: variant.label || base.label,
      sublabel: base.sublabel,
      guideTitle: (base.title || base.label || '') + (variant.label ? ' · ' + variant.label : ''),
      guideText: variant.guideText || base.desc || '',
      desc: variant.guideText || base.desc || '',
      media3D: variant.media3D || base.media3D,
      media2D: variant.media2D || base.media2D,
      variants: variants,
      activeVariantId: variant.id,
    };
  }

  function hideMediaOverlay() {
    var host = $('f3d-media-host');
    if (!host) return;
    host.innerHTML = '';
    host.hidden = true;
  }

  function rebuildSceneContent() {
    hideMediaOverlay();
    if (!state.root || typeof THREE === 'undefined') return;
    disposeCableMeshes();

    var entity = getActiveEntity();
    var media3D = entity && entity.media3D;
    if (media3D && media3D.type === 'custom-glb' && media3D.data && typeof THREE.GLTFLoader === 'function') {
      var loader = new THREE.GLTFLoader();
      loader.load(media3D.data, function (gltf) {
        disposeCableMeshes();
        if (!state.root) return;
        state.root.add(gltf.scene);
        state.propMeshes.push(gltf.scene);
        state.jacketMesh = gltf.scene;
      }, undefined, function () {
        buildProcedural3D();
        applyPeelVisibility();
      });
      return;
    }

    buildProcedural3D();
    applyPeelVisibility();
  }

  function buildProcedural3D() {
    if (state.component === 'cable') buildCableAnatomy();
    else if (state.component === 'fdt') buildFdtAnatomy();
    else if (state.component === 'splitter') buildSplitterAnatomy();
    else if (state.component === 'onu') buildOnuAnatomy();
    else buildOltAnatomy();
  }

  function buildCableAnatomy() {
    var cfg = CABLE_3D;
    var spec = getSpec();
    var n = spec.tubes.length;
    var layout = resolveLayout3d(n);
    state.layout3d = layout;
    var strands = getStrandOrder(spec);

    var core = new THREE.Mesh(
      new THREE.CylinderGeometry(layout.coreR, layout.coreR, cfg.coreLen, 28),
      new THREE.MeshStandardMaterial({
        color: 0xc5ccd6,
        roughness: 0.32,
        metalness: 0.62,
      })
    );
    core.rotation.z = Math.PI / 2;
    core.userData = { kind: 'core' };
    core.visible = false;
    state.root.add(core);
    state.coreMesh = core;
    state.propMeshes.push(core);

    var buffer = new THREE.Mesh(
      new THREE.CylinderGeometry(layout.bufferR, layout.bufferR, cfg.coreLen - 0.12, 28),
      new THREE.MeshStandardMaterial({
        color: 0x6b7280,
        roughness: 0.72,
        metalness: 0.12,
      })
    );
    buffer.rotation.z = Math.PI / 2;
    buffer.userData = { kind: 'coreBuffer' };
    buffer.visible = false;
    state.root.add(buffer);
    state.propMeshes.push(buffer);

    var jacket = new THREE.Mesh(
      new THREE.CylinderGeometry(layout.jacketR, layout.jacketR, cfg.jacketLen, 56),
      new THREE.MeshStandardMaterial({
        color: 0x141414,
        roughness: 0.88,
        metalness: 0.04,
      })
    );
    jacket.rotation.z = Math.PI / 2;
    jacket.userData = { kind: 'jacket', baseLen: cfg.jacketLen };
    state.root.add(jacket);
    state.jacketMesh = jacket;

    spec.tubes.forEach(function (tubeKey, i) {
      var angle = tubeAngle(n, i, layout.dualRing);
      var ringR = tubeRingRadius(layout, 0, i);
      var group = new THREE.Group();
      group.position.set(0, Math.cos(angle) * ringR, Math.sin(angle) * ringR);
      group.userData = {
        kind: 'tubeGroup',
        tubeIndex: i,
        striped: isTubeStriped(spec, i),
      };
      group.visible = false;

      var c = colorOf(tubeKey);
      var tube = new THREE.Mesh(
        new THREE.CylinderGeometry(layout.tubeR, layout.tubeR, cfg.tubeLen, 20),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(c.hex),
          roughness: 0.42,
          metalness: 0.1,
          transparent: true,
          opacity: 1,
        })
      );
      tube.rotation.z = Math.PI / 2;
      tube.userData = {
        kind: 'tube',
        tubeIndex: i,
        tubeColor: tubeKey,
        striped: isTubeStriped(spec, i),
      };
      group.add(tube);
      state.tubeMeshes.push(tube);

      /* Tubes 13–24: one thin black tracer stripe along tube mid-line */
      if (isTubeStriped(spec, i)) {
        var stripe = new THREE.Mesh(
          new THREE.BoxGeometry(cfg.tubeLen * 0.92, 0.022, layout.tubeR * 0.42),
          new THREE.MeshStandardMaterial({
            color: 0x0a0a0a,
            roughness: 0.92,
            metalness: 0.04,
          })
        );
        stripe.position.set(0, layout.tubeR + 0.002, 0);
        stripe.userData = { kind: 'stripe', tubeIndex: i };
        group.add(stripe);
      }

      strands.forEach(function (strandKey, si) {
        var sc = colorOf(strandKey);
        var a = (si / strands.length) * Math.PI * 2 - Math.PI / 2;
        var localR = layout.strandLocalR;
        var fiber = new THREE.Mesh(
          new THREE.CylinderGeometry(layout.strandR, layout.strandR, cfg.strandLen, 8),
          new THREE.MeshStandardMaterial({
            color: new THREE.Color(sc.hex),
            roughness: 0.28,
            metalness: 0.22,
            emissive: new THREE.Color(sc.hex),
            emissiveIntensity: strandKey === 'Black' || strandKey === 'Slate' ? 0.04 : 0.1,
          })
        );
        fiber.rotation.z = Math.PI / 2;
        fiber.position.set(0, Math.cos(a) * localR, Math.sin(a) * localR);
        fiber.visible = false;
        fiber.userData = {
          kind: 'strand',
          tubeIndex: i,
          strandIndex: si,
          strandColor: strandKey,
          localA: a,
          localR: localR,
        };
        group.add(fiber);
        state.strandMeshes.push(fiber);
      });

      state.root.add(group);
      state.tubeGroups.push(group);
    });
  }

  function buildFdtAnatomy() {
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 3.2, 1.2),
      new THREE.MeshStandardMaterial({ color: 0xb45309, roughness: 0.55, metalness: 0.25 })
    );
    state.root.add(body);
    state.propMeshes.push(body);
    state.jacketMesh = body;
    state.peelState = 0;
  }

  function buildSplitterAnatomy() {
    var housing = new THREE.Mesh(
      new THREE.BoxGeometry(2.6, 0.7, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x4c1d95, roughness: 0.5, metalness: 0.2 })
    );
    state.root.add(housing);
    state.jacketMesh = housing;
    state.propMeshes.push(housing);
    state.peelState = 0;
  }

  function buildOnuAnatomy() {
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.55, 1.35),
      new THREE.MeshStandardMaterial({ color: 0x155e75, roughness: 0.48, metalness: 0.22 })
    );
    state.root.add(body);
    state.propMeshes.push(body);
    state.jacketMesh = body;
    state.peelState = 0;
  }

  function buildOltAnatomy() {
    var chassis = new THREE.Mesh(
      new THREE.BoxGeometry(3.4, 1.4, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.55, metalness: 0.35 })
    );
    state.root.add(chassis);
    state.jacketMesh = chassis;
    state.propMeshes.push(chassis);
    state.peelState = 0;
  }

  /* ─── View controls ─── */

  function setViewMode(mode) {
    state.viewMode = mode === '2d' ? '2d' : '3d';
    var app = $('f3d-app');
    if (app) {
      app.classList.toggle('f3d-app--2d', state.viewMode === '2d');
      app.classList.toggle('f3d-app--3d', state.viewMode === '3d');
    }
    document.querySelectorAll('[data-f3d-view]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-f3d-view') === state.viewMode);
    });
    var host3d = $('f3d-canvas-host');
    var host2d = $('f3d-2d-host');
    if (host3d) host3d.hidden = state.viewMode !== '3d';
    if (host2d) host2d.hidden = state.viewMode !== '2d';
    hideMediaOverlay();
    renderInspector();
    setStatus(state.viewMode === '2d' ? '2D technical layout' : '3D dissection view');
    onResize();
  }

  function setAutoRotate(on) {
    state.autoRotate = !!on;
    var btn = $('f3d-auto-rotate');
    if (btn) {
      btn.classList.toggle('is-active', state.autoRotate);
      btn.setAttribute('aria-pressed', state.autoRotate ? 'true' : 'false');
      btn.textContent = state.autoRotate ? 'Auto-Rotate: On' : 'Auto-Rotate: Off';
    }
  }

  function setCapacity(cap) {
    var key = resolveCapacityKey(cap);
    if (key == null) return;
    state.capacity = key;
    state.component = 'cable';
    state.peelState = 0;
    state.selectedTube = null;
    state.activeVariantId = null;
    syncComponentButtons();
    rebuildSceneContent();
    renderInspector();
    setStatus(getSpec().label + ' selected · click jacket to peel');
  }

  function setComponent(id) {
    if (!COMPONENTS[id]) return;
    state.component = id;
    state.peelState = 0;
    state.selectedTube = null;
    var variants = COMPONENTS[id].variants || [];
    state.activeVariantId = COMPONENTS[id].activeVariantId || (variants[0] && variants[0].id) || null;
    syncComponentButtons();
    rebuildSceneContent();
    renderInspector();
    var variant = variants.filter(function (v) { return v.id === state.activeVariantId; })[0];
    setStatus(COMPONENTS[id].title + (variant ? ' · ' + variant.label : ''));
  }

  function syncComponentButtons() {
    document.querySelectorAll('[data-f3d-component]').forEach(function (btn) {
      btn.classList.toggle('is-active', btn.getAttribute('data-f3d-component') === state.component);
    });
    document.querySelectorAll('[data-f3d-capacity]').forEach(function (btn) {
      var key = resolveCapacityKey(btn.getAttribute('data-f3d-capacity'));
      btn.classList.toggle('is-active', state.component === 'cable' && key === state.capacity);
    });
  }

  /* ─── Picking ─── */

  function onStagePointerDown(e) {
    if (state.viewMode !== '3d' || !state.renderer) return;
    state.drag = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      pointerId: e.pointerId,
    };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }

  function onStagePointerMove(e) {
    if (!state.drag || !state.root) return;
    var dx = e.clientX - state.drag.x;
    var dy = e.clientY - state.drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.drag.moved = true;
    state.drag.x = e.clientX;
    state.drag.y = e.clientY;
    if (!state.drag.moved) return;
    if (e.shiftKey || e.buttons === 4) {
      if (state.camera) {
        state.camera.position.x -= dx * 0.012;
        state.camera.position.y += dy * 0.012;
      }
      return;
    }
    state.root.rotation.y += dx * 0.01;
    state.root.rotation.x += dy * 0.008;
    state.root.rotation.x = Math.max(-1.1, Math.min(1.1, state.root.rotation.x));
  }

  function onStagePointerUp(e) {
    if (!state.drag) return;
    var wasClick = !state.drag.moved;
    state.drag = null;
    if (wasClick) handleStageClick(e);
  }

  function handleStageClick(e) {
    if (state.component !== 'cable' || !state.renderer || !state.camera || !state.raycaster) return;
    var host = $('f3d-canvas-host');
    if (!host) return;
    var rect = host.getBoundingClientRect();
    state.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);

    var targets = [];
    if (state.peelState === 0 && state.jacketMesh) targets.push(state.jacketMesh);
    if (state.peelState >= 1) targets = targets.concat(state.tubeMeshes);
    if (state.peelState === 2) targets = targets.concat(state.strandMeshes.filter(function (m) { return m.visible; }));

    var hits = state.raycaster.intersectObjects(targets, false);
    if (!hits.length) return;
    var hit = hits[0].object;
    var kind = hit.userData && hit.userData.kind;
    if (kind === 'jacket' || (state.peelState === 0 && hit === state.jacketMesh)) {
      peelToTubes();
      return;
    }
    if (kind === 'tube') {
      openTubeStrands(hit.userData.tubeIndex);
    }
  }

  /* ─── Three.js lifecycle ─── */

  function initThree() {
    var host = $('f3d-canvas-host');
    if (!host || typeof THREE === 'undefined') {
      setStatus('3D engine unavailable');
      return;
    }

    var w = host.clientWidth || 800;
    var h = host.clientHeight || 500;

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0x000000);
    state.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100);
    state.camera.position.set(5.2, 2.6, 4.4);
    state.camera.lookAt(0.3, 0, 0);

    state.renderer = new THREE.WebGLRenderer({ antialias: true });
    state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    state.renderer.setSize(w, h, false);
    host.appendChild(state.renderer.domElement);

    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();

    state.scene.add(new THREE.AmbientLight(0xb8c4d6, 0.48));
    var key = new THREE.DirectionalLight(0xffffff, 1.15);
    key.position.set(5, 7, 4);
    state.scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.45);
    rim.position.set(-4, 2, -3);
    state.scene.add(rim);
    var fill = new THREE.DirectionalLight(0x94a3b8, 0.35);
    fill.position.set(1, -2, 5);
    state.scene.add(fill);

    state.root = new THREE.Group();
    state.root.rotation.set(0.35, -0.85, 0.15);
    state.scene.add(state.root);

    rebuildSceneContent();

    host.addEventListener('pointerdown', onStagePointerDown);
    host.addEventListener('pointermove', onStagePointerMove);
    host.addEventListener('pointerup', onStagePointerUp);
    host.addEventListener('pointerleave', function () { state.drag = null; });
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (!state.camera) return;
      var z = state.camera.position.z + (e.deltaY > 0 ? 0.35 : -0.35);
      state.camera.position.z = Math.max(2.8, Math.min(9, z));
    }, { passive: false });

    animate();
    window.addEventListener('resize', onResize);
  }

  function onResize() {
    var host = $('f3d-canvas-host');
    if (!host || !state.camera || !state.renderer || state.viewMode !== '3d') return;
    var w = host.clientWidth || 1;
    var h = host.clientHeight || 1;
    state.camera.aspect = w / h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(w, h, false);
  }

  function animate() {
    state.raf = requestAnimationFrame(animate);
    if (state.root && state.autoRotate && !state.drag && state.viewMode === '3d') {
      state.root.rotation.y += 0.0035;
    }
    if (state.renderer && state.scene && state.camera && state.viewMode === '3d') {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function bindUi() {
    var rail = $('f3d-rail');
    if (rail && !rail.getAttribute('data-f3d-rail-bound')) {
      rail.setAttribute('data-f3d-rail-bound', '1');
      rail.addEventListener('click', function (e) {
        var capBtn = e.target.closest ? e.target.closest('[data-f3d-capacity]') : null;
        if (capBtn) {
          setCapacity(capBtn.getAttribute('data-f3d-capacity'));
          return;
        }
        var compBtn = e.target.closest ? e.target.closest('[data-f3d-component]') : null;
        if (compBtn) setComponent(compBtn.getAttribute('data-f3d-component'));
      });
    }
    document.querySelectorAll('[data-f3d-view]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setViewMode(btn.getAttribute('data-f3d-view'));
      });
    });
    var rot = $('f3d-auto-rotate');
    if (rot) {
      rot.addEventListener('click', function () {
        setAutoRotate(!state.autoRotate);
      });
    }
    var reset = $('btn-reset-jacket') || $('f3d-reset-peel');
    if (reset) reset.addEventListener('click', resetPeel);
    var resetTubeBtn = $('btn-reset-tube');
    if (resetTubeBtn) resetTubeBtn.addEventListener('click', resetTube);
    var pills = $('f3d-variant-pills');
    if (pills && !pills.getAttribute('data-bound')) {
      pills.setAttribute('data-bound', '1');
      pills.addEventListener('click', function (e) {
        var btn = e.target.closest ? e.target.closest('[data-f3d-variant]') : null;
        if (btn) setActiveHardwareVariant(btn.getAttribute('data-f3d-variant'));
      });
    }
    syncAnatomyAdminSettingsButton();
    bindAdminSettingsUiAuthListener();
    syncCableUiChrome();
  }

  function isAdminPreviewContext() {
    try {
      if (window.self !== window.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function canShowSimulatorAdminSettingsUI() {
    if (window.IFAAuth && typeof window.IFAAuth.canShowSimulatorAdminSettingsUI === 'function') {
      return window.IFAAuth.canShowSimulatorAdminSettingsUI();
    }
    return false;
  }

  function syncAnatomyAdminSettingsButton() {
    var btn = document.getElementById('anatomy-admin-settings-btn');
    if (!btn) return;
    var show = canShowSimulatorAdminSettingsUI();
    btn.hidden = !show;
    btn.style.display = show ? 'inline-flex' : 'none';
    btn.classList.toggle('is-admin-visible', show);
  }

  function bindAdminSettingsUiAuthListener() {
    if (window.__ifaAnatomyAdminSettingsAuthListenerBound) return;
    if (!window.IFAAuth || typeof window.IFAAuth.onAuthChange !== 'function') {
      window.setTimeout(bindAdminSettingsUiAuthListener, 50);
      return;
    }
    window.__ifaAnatomyAdminSettingsAuthListenerBound = true;
    window.IFAAuth.onAuthChange(function () {
      syncAnatomyAdminSettingsButton();
    });
  }

  function boot() {
    applyAnatomyConfigFromStore();
    bindUi();
    renderCableRail();
    syncComponentButtons();
    setAutoRotate(true);
    setViewMode('3d');
    var firstCap = resolveCapacityKey(state.capacity) || Object.keys(CABLE_SPECS)[0] || 12;
    setCapacity(firstCap);
    initThree();
    window.addEventListener('ifa:anatomy-config-saved', function () {
      applyAnatomyConfigFromStore();
      renderCableRail();
      if (state.component !== 'cable' && COMPONENTS[state.component]) {
        state.activeVariantId = COMPONENTS[state.component].activeVariantId || state.activeVariantId;
      }
      rebuildSceneContent();
      renderInspector();
      setStatus('Anatomy CMS saved · workspace updated');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
