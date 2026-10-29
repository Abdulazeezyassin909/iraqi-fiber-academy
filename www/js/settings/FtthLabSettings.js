/**
 * FTTH Lab — device metadata, toolbox icons, specs persistence + undo/redo.
 * localStorage key: ifa_ftth_lab_config
 */
(function (global) {
  'use strict';

  var MAX_HISTORY = 60;
  var MAX_ICON_CHARS = 1800000;

  var DEFAULT_SPLITTER_LOSSES = {
    '1x4': 7.3,
    '1x8': 10.5,
    '1x16': 13.8,
    '1x32': 17.1,
    '1x64': 21.0,
    '2x4': 7.3,
  };

  var PERFORMANCE_TOOL_KEYS = ['chassis', 'sfp', 'ols', 'opm'];
  var SPLICING_TOOL_KEYS = ['fiber-cleaver', 'fusion-splicer-machine'];
  /** DOM data-lab-tool values that map to a settings toolKey */
  var TOOL_KEY_DOM_ALIASES = {
    cleaver: 'fiber-cleaver',
  };

  var FACTORY_SFP_VARIANTS = [
    {
      id: 'huawei-ssx1t1ltb',
      name: 'Huawei SSX1T1LTB (GPON Class B+)',
      shortName: 'GPON B+',
      txNm: 1490,
      rxNm: 1310,
      performanceSpecs: {
        powerRangeDbm: { min: 1.5, max: 5.0 },
        txLevels: [1.5, 3.0, 5.0],
        rxLevels: [-28],
        txDefault: 3.0,
        sensitivity: -28,
      },
    },
    {
      id: 'gpon-cplus',
      name: 'GPON OLT Class C+',
      shortName: 'GPON C+',
      txNm: 1490,
      rxNm: 1310,
      performanceSpecs: {
        powerRangeDbm: { min: 3.0, max: 7.0 },
        txLevels: [3.0, 5.0, 7.0],
        rxLevels: [-32],
        txDefault: 5.0,
        sensitivity: -32,
      },
    },
    {
      id: 'xgs-pon-n1n2',
      name: 'XGS-PON N1/N2',
      shortName: 'XGS-PON',
      txNm: 1577,
      rxNm: 1270,
      performanceSpecs: {
        powerRangeDbm: { min: 4.0, max: 9.0 },
        txLevels: [4.0, 5.5, 7.0, 9.0],
        rxLevels: [-28],
        txDefault: 5.5,
        sensitivity: -28,
      },
    },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var FACTORY_DEFAULT_FTTH_LAB_CONFIG = {
    version: 3,
    sfpVariants: clone(FACTORY_SFP_VARIANTS),
    categories: [
      { id: 'active', label: 'ACTIVE EQUIPMENT' },
      { id: 'splitters', label: 'SPLITTERS' },
      { id: 'test', label: 'TEST EQUIPMENT' },
      { id: 'splicing', label: 'SPLICING EQUIPMENT' },
      { id: 'termination', label: 'PATCH PANELS / TERMINATION' },
    ],
    items: [
      {
        id: 'chassis', toolKey: 'chassis', categoryId: 'active',
        label: 'Nokia 7360 FX-16', sublabel: 'OLT', markClass: 'chassis', icon: '',
        guideText: 'Drag onto the workspace to place the OLT chassis.',
        performanceSpecs: {
          powerRangeDbm: { min: -32, max: 9.0 },
          txLevels: [],
          rxLevels: [-32, -28],
        },
      },
      {
        id: 'card', toolKey: 'card', categoryId: 'active',
        label: 'FGLT-D Line Card', sublabel: 'Line card', markClass: 'card', icon: '',
        guideText: 'Drop onto an empty LT slot on the FX-16 chassis.',
      },
      {
        id: 'sfp', toolKey: 'sfp', categoryId: 'active',
        label: 'SFP Transceiver', sublabel: 'Optical module', markClass: 'sfp', icon: '',
        guideText: 'Drop onto an empty square port on an installed FGLT-D line card.',
        specs: { txLevels: [-3, -6], defaultTxDbm: -3 },
        performanceSpecs: {
          powerRangeDbm: { min: 1.5, max: 9.0 },
          txLevels: [1.5, 3.0, 5.0, 7.0],
          rxLevels: [-32, -28],
        },
      },
      {
        id: 'splitter', toolKey: 'splitter', categoryId: 'splitters',
        label: 'Splitter', sublabel: 'Configure on workspace', markClass: 'splitter', icon: '',
        guideText: 'Select ratio and port polish (UPC/APC) in the properties panel.',
        specs: { losses: clone(DEFAULT_SPLITTER_LOSSES) },
      },
      {
        id: 'opm', toolKey: 'opm', categoryId: 'test',
        label: 'Viavi OLP-38', sublabel: 'SC dock · live dBm', markClass: 'opm', icon: '',
        guideText: 'Dock an SC Patch Cord or Pigtail into the metal adapter on top.',
        performanceSpecs: {
          powerRangeDbm: { min: -70, max: 10 },
          txLevels: [],
          rxLevels: [-70, -10],
        },
      },
      {
        id: 'ols', toolKey: 'ols', categoryId: 'test',
        label: 'OLS-35', sublabel: 'Calibrated source · 1310 / 1550', markClass: 'ols', icon: '',
        guideText: 'Calibrated optical source · 1310 / 1550 nm · dock a patch cord, then enable laser.',
        specs: { txLevels: [-3, -6], defaultTxDbm: -3 },
        performanceSpecs: {
          powerRangeDbm: { min: -6, max: 3 },
          txLevels: [-3, -6],
          rxLevels: [],
        },
      },
      {
        id: 'otdr-machine', toolKey: 'otdr-machine', categoryId: 'test',
        label: 'OTDR Machine', sublabel: 'VIAVI SmartOTDR', markClass: 'otdr', icon: '',
        guideText: 'Drag onto the workspace to place the OTDR test set.',
      },
      {
        id: 'vfl', toolKey: 'vfl', categoryId: 'test',
        label: 'Visual Fault Locator', sublabel: '10 mW · 650 nm laser', markClass: 'vfl', icon: '',
        guideText: 'Dock SC fiber and enable the red fault locator laser.',
      },
      {
        id: 'jig', toolKey: 'jig', categoryId: 'test',
        label: 'Macro-Bend Tester', sublabel: 'Articulated slot · 0–180°', markClass: 'jig', icon: '',
        guideText: 'Route a patch cord through the slot and set bend angle θ in properties.',
      },
      {
        id: 'fiber-cleaver', toolKey: 'fiber-cleaver', categoryId: 'splicing',
        label: 'Fiber Cleaver', sublabel: 'Precision cleave · V-groove', markClass: 'cleaver', icon: '',
        guideText: 'Seat bare fiber in the V-groove and clamp to cleave.',
        specs: { bareGlassLengthAfterCutPx: 16 },
      },
      {
        id: 'fusion-splicer-machine', toolKey: 'fusion-splicer-machine', categoryId: 'splicing',
        label: 'Fusion Splicer', sublabel: 'Machine UI · drag to grid', markClass: 'fusion-machine', icon: '',
        guideText: 'Place on the workspace · load fibers in L/R clamps · close lids · SET to arc weld.',
        specs: { splicerClampForwardPx: 95, splicerClampBackwardPx: 0 },
      },
      {
        id: 'stripper', toolKey: 'stripper', categoryId: 'splicing',
        label: 'CFS-3 Stripper', sublabel: 'Fiber buffer stripper', markClass: 'stripper', icon: '',
        guideText: 'Drag onto the workspace · strip buffer and coating from fiber.',
      },
      {
        id: 'sleeve', toolKey: 'sleeve', categoryId: 'splicing',
        label: 'Protection Sleeve', sublabel: '60 mm splice sleeve', markClass: 'sleeve', icon: '',
        guideText: 'Drag onto the workspace · heat-shrink splice protection sleeve.',
      },
      {
        id: 'cleaning-wipe', toolKey: 'cleaning-wipe', categoryId: 'splicing',
        label: 'Cleaning Wipes', sublabel: 'IPA fiber cleaning', markClass: 'cleaning-wipe', icon: '',
        guideText: 'Drag onto the workspace · clean ferrule and bare fiber ends.',
      },
      {
        id: 'patchcord', toolKey: 'patchcord', categoryId: 'termination',
        label: 'Patch Cord', sublabel: 'A ↔ B same click-drag rules', markClass: 'pcord', icon: '',
        guideText: 'Drag both ends · SC/UPC or SC/APC · meter mode in properties.',
      },
      {
        id: 'cable', toolKey: 'cable', categoryId: 'termination',
        label: 'Bare Fiber Cable', sublabel: 'Dual bare-end drop cable', markClass: 'cable', icon: '',
        guideText: 'Drag onto the workspace to place bare fiber cable.',
      },
      {
        id: 'pigtail', toolKey: 'pigtail', categoryId: 'termination',
        label: 'SC Pigtail', sublabel: 'SC connector + bare fiber', markClass: 'pigtail', icon: '',
        guideText: 'SC connector on one end · bare fiber tail for splicing or winding.',
      },
      {
        id: 'spool', toolKey: 'spool', categoryId: 'termination',
        label: 'Fiber Spool', sublabel: 'Type in properties panel', markClass: 'spool', icon: '',
        guideText: 'Pin spool on workspace · set fiber type and length in properties.',
      },
      {
        id: 'coupler', toolKey: 'coupler', categoryId: 'termination',
        label: 'SC/APC Coupler', sublabel: 'Inline sleeve · 0.2–0.5 dB IL', markClass: 'cpl', icon: '',
        guideText: 'Inline SC adapter · switch UPC/APC type in properties.',
      },
    ],
  };

  function clipIcon(src) {
    var value = typeof src === 'string' ? src : '';
    if (value.length > MAX_ICON_CHARS) return '';
    return value;
  }

  function parseTxLevels(value) {
    if (Array.isArray(value)) {
      return value.map(Number).filter(function (n) { return isFinite(n); });
    }
    return String(value == null ? '' : value)
      .split(/[,;\s]+/)
      .map(function (s) { return parseFloat(s.trim()); })
      .filter(function (n) { return isFinite(n); });
  }

  function normalizePerformanceSpecs(raw, factory) {
    raw = raw && typeof raw === 'object' ? raw : {};
    factory = factory && typeof factory === 'object' ? factory : {};
    var rawRange = raw.powerRangeDbm && typeof raw.powerRangeDbm === 'object' ? raw.powerRangeDbm : {};
    var factoryRange = factory.powerRangeDbm && typeof factory.powerRangeDbm === 'object'
      ? factory.powerRangeDbm
      : {};
    var minVal = rawRange.min != null ? Number(rawRange.min) : factoryRange.min;
    var maxVal = rawRange.max != null ? Number(rawRange.max) : factoryRange.max;
    var out = {
      powerRangeDbm: {
        min: isFinite(minVal) ? minVal : null,
        max: isFinite(maxVal) ? maxVal : null,
      },
      txLevels: parseTxLevels(raw.txLevels != null ? raw.txLevels : factory.txLevels),
      rxLevels: parseTxLevels(raw.rxLevels != null ? raw.rxLevels : factory.rxLevels),
    };
    if (raw.txDefault != null || factory.txDefault != null) {
      out.txDefault = Number(raw.txDefault != null ? raw.txDefault : factory.txDefault);
    }
    if (raw.sensitivity != null || factory.sensitivity != null) {
      out.sensitivity = Number(raw.sensitivity != null ? raw.sensitivity : factory.sensitivity);
    }
    return out;
  }

  function normalizeSfpVariant(raw) {
    var v = raw && typeof raw === 'object' ? raw : {};
    var factory = FACTORY_SFP_VARIANTS.filter(function (fv) { return fv.id === v.id; })[0] || {};
    return {
      id: String(v.id || factory.id || ('sfp_' + Date.now())),
      name: String(v.name || factory.name || 'SFP Variant'),
      shortName: String(v.shortName || factory.shortName || 'SFP'),
      txNm: Number(v.txNm != null ? v.txNm : factory.txNm) || 1490,
      rxNm: Number(v.rxNm != null ? v.rxNm : factory.rxNm) || 1310,
      performanceSpecs: normalizePerformanceSpecs(v.performanceSpecs, factory.performanceSpecs),
    };
  }

  function normalizeSfpVariants(list) {
    var src = Array.isArray(list) ? list : [];
    var byId = {};
    var out = [];
    src.forEach(function (v) {
      var norm = normalizeSfpVariant(v);
      if (!byId[norm.id]) {
        byId[norm.id] = true;
        out.push(norm);
      }
    });
    if (!out.length) return clone(FACTORY_SFP_VARIANTS).map(normalizeSfpVariant);
    FACTORY_SFP_VARIANTS.forEach(function (fv) {
      if (!byId[fv.id]) out.push(normalizeSfpVariant(fv));
    });
    return out;
  }

  function normalizeSpecs(toolKey, specs, factorySpecs) {
    specs = specs && typeof specs === 'object' ? specs : {};
    factorySpecs = factorySpecs && typeof factorySpecs === 'object' ? factorySpecs : {};

    if (toolKey === 'ols' || toolKey === 'sfp') {
      var levels = parseTxLevels(specs.txLevels != null ? specs.txLevels : factorySpecs.txLevels);
      if (!levels.length) levels = parseTxLevels(factorySpecs.txLevels || [-3, -6]);
      if (!levels.length) levels = [-3, -6];
      var def = Number(specs.defaultTxDbm != null ? specs.defaultTxDbm : factorySpecs.defaultTxDbm);
      if (!isFinite(def) || levels.indexOf(def) < 0) {
        def = levels.indexOf(-3) >= 0 ? -3 : levels[0];
      }
      return { txLevels: levels, defaultTxDbm: def };
    }

    if (toolKey === 'splitter') {
      var losses = clone(factorySpecs.losses || DEFAULT_SPLITTER_LOSSES);
      if (specs.losses && typeof specs.losses === 'object') {
        Object.keys(specs.losses).forEach(function (k) {
          var n = Number(specs.losses[k]);
          if (isFinite(n)) losses[k] = n;
        });
      }
      return { losses: losses };
    }

    if (toolKey === 'fiber-cleaver') {
      var bareLen = Number(
        specs.bareGlassLengthAfterCutPx != null
          ? specs.bareGlassLengthAfterCutPx
          : factorySpecs.bareGlassLengthAfterCutPx
      );
      if (!isFinite(bareLen) || bareLen < 1) bareLen = 16;
      return { bareGlassLengthAfterCutPx: Math.round(bareLen) };
    }

    if (toolKey === 'fusion-splicer-machine') {
      var forward = Number(
        specs.splicerClampForwardPx != null
          ? specs.splicerClampForwardPx
          : (specs.splicerClampTravelPx != null
            ? specs.splicerClampTravelPx
            : (specs.splicer_clamp_travel != null
              ? specs.splicer_clamp_travel
              : factorySpecs.splicerClampForwardPx))
      );
      var backward = Number(
        specs.splicerClampBackwardPx != null
          ? specs.splicerClampBackwardPx
          : factorySpecs.splicerClampBackwardPx
      );
      if (!isFinite(forward) || forward < 0) forward = 95;
      if (!isFinite(backward) || backward < 0) backward = 0;
      if (forward > 200) forward = 200;
      if (backward > 200) backward = 200;
      return {
        splicerClampForwardPx: Math.round(forward),
        splicerClampBackwardPx: Math.round(backward),
      };
    }

    return specs;
  }

  function factoryItemFor(item) {
    return FACTORY_DEFAULT_FTTH_LAB_CONFIG.items.filter(function (fi) {
      return fi.id === item.id || fi.toolKey === item.toolKey;
    })[0] || {};
  }

  function normalizeVisible(value, fallback) {
    if (fallback === undefined) fallback = true;
    if (typeof value === 'boolean') return value;
    if (value === 'false' || value === 0 || value === '0') return false;
    if (value === 'true' || value === 1 || value === '1') return true;
    return fallback;
  }

  function mergeLocalVisibilityIntoRemoteConfig(remote, local) {
    var remoteSrc = remote && typeof remote === 'object' ? clone(remote) : { items: [] };
    var localSrc = local && typeof local === 'object' ? local : { items: [] };
    if (!Array.isArray(remoteSrc.items)) remoteSrc.items = [];
    var localVis = {};
    (localSrc.items || []).forEach(function (it) {
      if (it && it.toolKey && it.visible === false) {
        localVis[it.toolKey] = false;
      }
    });
    remoteSrc.items = remoteSrc.items.map(function (it) {
      if (!it || !it.toolKey) return it;
      if (Object.prototype.hasOwnProperty.call(it, 'visible')) return it;
      if (localVis[it.toolKey] === false) {
        return Object.assign({}, it, { visible: false });
      }
      return it;
    });
    return remoteSrc;
  }

  function normalizeItem(raw) {
    var item = raw && typeof raw === 'object' ? raw : {};
    var factory = factoryItemFor(item);
    var toolKey = String(item.toolKey || factory.toolKey || '');
    var hasVisibleKey = Object.prototype.hasOwnProperty.call(item, 'visible');
    var visibleFallback = hasVisibleKey ? true : normalizeVisible(factory.visible, true);
    var out = {
      id: String(item.id || factory.id || ('tool_' + Date.now())),
      toolKey: toolKey,
      categoryId: String(item.categoryId || factory.categoryId || 'active'),
      label: String(item.label || factory.label || 'Toolbox item'),
      sublabel: String(item.sublabel || factory.sublabel || ''),
      guideText: String(item.guideText || factory.guideText || item.sublabel || factory.sublabel || ''),
      markClass: String(item.markClass || factory.markClass || ''),
      icon: clipIcon(item.icon || ''),
      visible: normalizeVisible(item.visible, visibleFallback),
      specs: normalizeSpecs(toolKey, item.specs, factory.specs),
    };
    if (PERFORMANCE_TOOL_KEYS.indexOf(toolKey) >= 0) {
      out.performanceSpecs = normalizePerformanceSpecs(item.performanceSpecs, factory.performanceSpecs);
    }
    return out;
  }

  function normalizeConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var factory = FACTORY_DEFAULT_FTTH_LAB_CONFIG;
    var cats = Array.isArray(src.categories) && src.categories.length
      ? src.categories
      : factory.categories;
    var byKey = {};
    var items = [];
    if (Array.isArray(src.items)) {
      src.items.forEach(function (it) {
        var norm = normalizeItem(it);
        if (norm.toolKey) {
          byKey[norm.toolKey] = norm;
          items.push(norm);
        }
      });
    }
    factory.items.forEach(function (fi) {
      if (!byKey[fi.toolKey]) items.push(normalizeItem(fi));
      else {
        var idx = items.findIndex(function (it) { return it.toolKey === fi.toolKey; });
        if (idx >= 0) {
          var savedItem = items[idx];
          var merged = Object.assign({}, fi, savedItem);
          if (Object.prototype.hasOwnProperty.call(savedItem, 'visible')) {
            merged.visible = normalizeVisible(savedItem.visible, true);
          }
          items[idx] = normalizeItem(merged);
        }
      }
    });
    var catIds = {};
    cats.forEach(function (c) { catIds[c.id] = true; });
    factory.categories.forEach(function (fc) {
      if (!catIds[fc.id]) cats.push({ id: fc.id, label: fc.label });
    });
    items.sort(function (a, b) {
      var ai = factory.items.findIndex(function (fi) { return fi.toolKey === a.toolKey; });
      var bi = factory.items.findIndex(function (fi) { return fi.toolKey === b.toolKey; });
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    return {
      version: 3,
      sfpVariants: normalizeSfpVariants(src.sfpVariants),
      categories: cats.map(function (c) {
        return {
          id: String((c && c.id) || 'active'),
          label: String((c && c.label) || ''),
        };
      }),
      items: items,
    };
  }

  function storageMetaKey(storageKey) {
    return storageKey + '_meta';
  }

  function readStorageMeta(storageKey) {
    try {
      var raw = global.localStorage.getItem(storageMetaKey(storageKey));
      if (!raw) return 0;
      var meta = JSON.parse(raw);
      var n = Number(meta && meta.clientUpdatedAt);
      return isFinite(n) && n > 0 ? n : 0;
    } catch (err) {
      return 0;
    }
  }

  function isRemoteConfigOlderThanLocal(storageKey, remoteData) {
    var localAt = readStorageMeta(storageKey);
    if (localAt <= 0) return false;
    if (!remoteData || typeof remoteData !== 'object') return true;
    var remoteAt = Number(remoteData.clientUpdatedAt);
    if (!isFinite(remoteAt) || remoteAt <= 0) return true;
    return remoteAt < localAt;
  }

  function loadSaved(storageKey, factoryConfig) {
    try {
      var raw = global.localStorage.getItem(storageKey);
      if (!raw) return clone(factoryConfig);
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      console.warn('[FtthLabSettings] Failed to parse local config; using factory defaults.', storageKey);
      return clone(factoryConfig);
    }
  }

  function emit(name, detail) {
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (err) { /* ignore */ }
  }

  function persistSaved(storageKey, data, clientUpdatedAt) {
    var at = Number(clientUpdatedAt);
    if (!isFinite(at) || at <= 0) at = Date.now();
    try {
      global.localStorage.setItem(storageKey, JSON.stringify(data));
      global.localStorage.setItem(storageMetaKey(storageKey), JSON.stringify({ clientUpdatedAt: at }));
      return true;
    } catch (err) {
      console.warn('[FtthLabSettings] localStorage persist failed', storageKey, err);
      return false;
    }
  }

  function resolveFirestorePublisher(apiKey) {
    if (apiKey === 'opm') return global.PlatformOpmConfigFirestore;
    if (apiKey === 'otdr') return global.PlatformOtdrConfigFirestore;
    if (apiKey === 'splicer') return global.PlatformSplicerConfigFirestore;
    return global.PlatformFtthLabConfigFirestore;
  }

  function publishConfigToFirestore(config, apiKey) {
    var payload = clone(config);
    var publisherKey = apiKey || 'ftth';
    function attempt(remaining) {
      var fs = resolveFirestorePublisher(publisherKey);
      if (fs && typeof fs.saveConfig === 'function') {
        try {
          var result = fs.saveConfig(payload);
          if (result && typeof result.catch === 'function') {
            result.catch(function (err) {
              console.error('[FtthLabSettings] Firestore publish failed', err);
            });
          }
        } catch (err) {
          console.error('[FtthLabSettings] Firestore publish failed', err);
        }
        return;
      }
      if (remaining <= 0) return;
      setTimeout(function () { attempt(remaining - 1); }, 250);
    }
    attempt(12);
  }

  function clearCustomIconStyles(mark) {
    if (!mark) return;
    mark.classList.remove('lab-tool__mark--custom');
    mark.style.backgroundImage = '';
    mark.style.backgroundSize = '';
    mark.style.backgroundRepeat = '';
    mark.style.backgroundPosition = '';
    mark.style.backgroundColor = '';
    mark.style.borderColor = '';
    mark.style.boxShadow = '';
  }

  function applyIconToMark(mark, icon, markClass) {
    if (!mark) return;
    if (markClass && !mark.classList.contains('lab-tool__mark--' + markClass)) {
      mark.className = 'lab-tool__mark lab-tool__mark--' + markClass;
    }
    if (icon && icon.indexOf('data:image') === 0) {
      mark.classList.add('lab-tool__mark--custom');
      mark.style.backgroundImage = 'url("' + icon.replace(/"/g, '\\"') + '")';
      mark.style.backgroundSize = 'contain';
      mark.style.backgroundRepeat = 'no-repeat';
      mark.style.backgroundPosition = 'center';
      mark.style.backgroundColor = 'transparent';
      mark.style.borderColor = 'rgba(148, 163, 184, 0.25)';
      mark.style.boxShadow = 'none';
    } else {
      clearCustomIconStyles(mark);
    }
  }

  function itemMapFromConfig(config) {
    var map = {};
    normalizeConfig(config).items.forEach(function (item) {
      if (item.toolKey) map[item.toolKey] = item;
    });
    return map;
  }

  function resolveToolKeyFromDom(domKey) {
    if (!domKey) return '';
    return TOOL_KEY_DOM_ALIASES[domKey] || domKey;
  }

  function applyToolboxIcons(config) {
    var iconMap = itemMapFromConfig(config || {});
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = resolveToolKeyFromDom(btn.getAttribute('data-lab-tool'));
      var item = iconMap[key];
      var mark = btn.querySelector('.lab-tool__mark');
      if (!mark || !item) return;
      applyIconToMark(mark, item.icon, item.markClass);
    });
  }

  function applyToolboxLabels(config) {
    var labelMap = itemMapFromConfig(config || {});
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = resolveToolKeyFromDom(btn.getAttribute('data-lab-tool'));
      var item = labelMap[key];
      if (!item) return;
      var strong = btn.querySelector('.lab-tool__copy strong');
      var span = btn.querySelector('.lab-tool__copy span');
      if (strong) strong.textContent = item.label;
      if (span) span.textContent = item.sublabel;
    });
  }

  function applyToolboxVisibility(config) {
    var visMap = itemMapFromConfig(config || {});
    document.querySelectorAll('.lab-rail .lab-tool[data-lab-tool]').forEach(function (btn) {
      var key = resolveToolKeyFromDom(btn.getAttribute('data-lab-tool'));
      var item = visMap[key];
      var show = !item || item.visible !== false;
      btn.hidden = !show;
      btn.style.display = show ? '' : 'none';
      btn.setAttribute('aria-hidden', show ? 'false' : 'true');
      btn.classList.toggle('is-lab-tool-hidden', !show);
      if (show) {
        if (btn.classList.contains('is-used')) {
          btn.draggable = false;
        } else if (btn.getAttribute('data-lab-tool-drag-disabled') !== '1') {
          btn.draggable = true;
        }
      } else {
        btn.draggable = false;
      }
    });
    document.querySelectorAll('.lab-rail .lab-hw-tree').forEach(function (tree) {
      var tools = tree.querySelectorAll('.lab-tool[data-lab-tool]');
      if (!tools.length) {
        tree.hidden = true;
        tree.style.display = 'none';
        return;
      }
      var any = false;
      tools.forEach(function (btn) {
        if (!btn.hidden && btn.style.display !== 'none') any = true;
      });
      tree.hidden = !any;
      tree.style.display = any ? '' : 'none';
    });
    document.querySelectorAll('.lab-rail .lab-rail__group').forEach(function (group) {
      var tools = group.querySelectorAll('.lab-tool[data-lab-tool]');
      if (!tools.length) return;
      var any = false;
      tools.forEach(function (btn) {
        if (!btn.hidden && btn.style.display !== 'none') any = true;
      });
      group.hidden = !any;
      group.style.display = any ? '' : 'none';
    });
  }

  function applyToolboxPresentation(config) {
    applyToolboxIcons(config);
    applyToolboxLabels(config);
    applyToolboxVisibility(config);
  }

  function createLabDeviceConfigStore(options) {
    options = options || {};
    var storageKey = options.storageKey || 'ifa_ftth_lab_config';
    var eventPrefix = options.eventPrefix || 'ifa:ftth-lab';
    var firestoreApi = options.firestoreApi || 'ftth';
    var factoryConfig = options.factoryConfig
      ? clone(options.factoryConfig)
      : clone(FACTORY_DEFAULT_FTTH_LAB_CONFIG);
    var savedEvt = eventPrefix + '-config-saved';
    var draftEvt = eventPrefix + '-draft-changed';

    var saved = loadSaved(storageKey, factoryConfig);
    var draft = clone(saved);
    var historyStack = [clone(draft)];
    var historyPointer = 0;

  var Store = {
    STORAGE_KEY: storageKey,
    STORAGE_META_KEY: storageMetaKey(storageKey),
    FIRESTORE_API: firestoreApi,
    EVENTS: { saved: savedEvt, draft: draftEvt },
    TOOL_KEY_DOM_ALIASES: TOOL_KEY_DOM_ALIASES,
    resolveToolKeyFromDom: resolveToolKeyFromDom,
    FACTORY_DEFAULT_FTTH_LAB_CONFIG: factoryConfig,
    DEFAULT_SPLITTER_LOSSES: DEFAULT_SPLITTER_LOSSES,
    MAX_ICON_CHARS: MAX_ICON_CHARS,
    parseTxLevels: parseTxLevels,

    getActiveConfig: function () {
      return clone(saved);
    },

    getLocalClientUpdatedAt: function () {
      return readStorageMeta(storageKey);
    },

    getDraft: function () {
      return clone(draft);
    },

    getItem: function (toolKey) {
      if (!toolKey) return null;
      var item = saved.items.filter(function (it) { return it.toolKey === toolKey; })[0];
      return item ? clone(item) : null;
    },

    getPerformanceSpecs: function (toolKey) {
      var item = Store.getItem(toolKey);
      return item && item.performanceSpecs ? clone(item.performanceSpecs) : null;
    },

    getSfpVariants: function () {
      return clone(saved.sfpVariants || FACTORY_SFP_VARIANTS);
    },

    getSfpVariant: function (variantId) {
      var list = Store.getSfpVariants();
      var found = list.filter(function (v) { return v.id === variantId; })[0];
      return found ? clone(found) : null;
    },

    updateSfpVariant: function (variantId, patch, recordHistory) {
      var next = clone(draft);
      next.sfpVariants = normalizeSfpVariants(next.sfpVariants);
      var idx = next.sfpVariants.findIndex(function (v) { return v.id === variantId; });
      if (idx < 0) return false;
      next.sfpVariants[idx] = normalizeSfpVariant(Object.assign({}, next.sfpVariants[idx], patch, {
        id: variantId,
        performanceSpecs: Object.assign(
          {},
          next.sfpVariants[idx].performanceSpecs,
          patch && patch.performanceSpecs
        ),
      }));
      Store.setDraft(next, recordHistory !== false);
      return true;
    },

    addSfpVariant: function () {
      var next = clone(draft);
      next.sfpVariants = normalizeSfpVariants(next.sfpVariants);
      var id = 'sfp_' + Date.now();
      next.sfpVariants.push(normalizeSfpVariant({
        id: id,
        name: 'New SFP Variant',
        shortName: 'SFP',
        txNm: 1490,
        rxNm: 1310,
        performanceSpecs: {
          powerRangeDbm: { min: 0, max: 5 },
          txLevels: [0, 3, 5],
          rxLevels: [-28],
          txDefault: 3,
          sensitivity: -28,
        },
      }));
      Store.setDraft(next, true);
      return id;
    },

    removeSfpVariant: function (variantId) {
      var next = clone(draft);
      next.sfpVariants = normalizeSfpVariants(next.sfpVariants);
      if (next.sfpVariants.length <= 1) return false;
      next.sfpVariants = next.sfpVariants.filter(function (v) { return v.id !== variantId; });
      Store.setDraft(next, true);
      return true;
    },

    updatePerformanceSpecs: function (toolKey, patch, recordHistory) {
      var item = draft.items.filter(function (it) { return it.toolKey === toolKey; })[0];
      if (!item) return false;
      var merged = normalizePerformanceSpecs(
        Object.assign({}, item.performanceSpecs, patch, {
          powerRangeDbm: Object.assign(
            {},
            item.performanceSpecs && item.performanceSpecs.powerRangeDbm,
            patch && patch.powerRangeDbm
          ),
        }),
        factoryItemFor(item).performanceSpecs
      );
      return Store.updateItem(toolKey, { performanceSpecs: merged }, recordHistory !== false);
    },

    getSplicerClampLimits: function () {
      var item = Store.getItem('fusion-splicer-machine');
      var factoryItem = factoryItemFor(
        item || { toolKey: 'fusion-splicer-machine', id: 'fusion-splicer-machine' }
      );
      var norm = normalizeSpecs(
        'fusion-splicer-machine',
        item && item.specs ? item.specs : {},
        factoryItem && factoryItem.specs ? factoryItem.specs : {}
      );
      return {
        forward: norm.splicerClampForwardPx,
        backward: norm.splicerClampBackwardPx,
      };
    },

    PERFORMANCE_TOOL_KEYS: PERFORMANCE_TOOL_KEYS,
    SPLICING_TOOL_KEYS: SPLICING_TOOL_KEYS,
    FACTORY_SFP_VARIANTS: FACTORY_SFP_VARIANTS,

    getIconForTool: function (toolKey) {
      var item = Store.getItem(toolKey);
      return item && item.icon ? item.icon : '';
    },

    setDraft: function (next, recordHistory) {
      draft = normalizeConfig(next);
      if (recordHistory !== false) {
        historyStack = historyStack.slice(0, historyPointer + 1);
        historyStack.push(clone(draft));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        historyPointer = historyStack.length - 1;
      }
      applyToolboxPresentation(draft);
      emit(draftEvt, { draft: clone(draft) });
    },

    updateItem: function (toolKey, patch, recordHistory) {
      if (!toolKey || !patch || typeof patch !== 'object') return false;
      var next = clone(draft);
      var found = false;
      next.items = next.items.map(function (it) {
        if (it.toolKey !== toolKey) return it;
        found = true;
        var merged = Object.assign({}, it, patch);
        if (Object.prototype.hasOwnProperty.call(patch, 'visible')) {
          merged.visible = normalizeVisible(patch.visible, true);
        }
        if (patch.specs) {
          merged.specs = normalizeSpecs(toolKey, Object.assign({}, it.specs, patch.specs), factoryItemFor(it).specs);
        }
        if (patch.performanceSpecs) {
          merged.performanceSpecs = normalizePerformanceSpecs(
            Object.assign({}, it.performanceSpecs, patch.performanceSpecs),
            factoryItemFor(it).performanceSpecs
          );
        }
        return normalizeItem(merged);
      });
      if (!found) return false;
      Store.setDraft(next, recordHistory !== false);
      return true;
    },

    setToolIcon: function (toolKey, iconData, recordHistory) {
      return Store.updateItem(toolKey, { icon: clipIcon(iconData || '') }, recordHistory);
    },

    canUndo: function () { return historyPointer > 0; },
    canRedo: function () { return historyPointer < historyStack.length - 1; },

    undo: function () {
      if (!Store.canUndo()) return false;
      historyPointer -= 1;
      draft = clone(historyStack[historyPointer]);
      applyToolboxPresentation(draft);
      emit(draftEvt, { draft: clone(draft) });
      return true;
    },

    redo: function () {
      if (!Store.canRedo()) return false;
      historyPointer += 1;
      draft = clone(historyStack[historyPointer]);
      applyToolboxPresentation(draft);
      emit(draftEvt, { draft: clone(draft) });
      return true;
    },

    resetToDefaults: function () {
      Store.setDraft(clone(factoryConfig), true);
    },

    saveChanges: function () {
      saved = clone(draft);
      console.log('[FtthLabSettings] Saved Config:', saved);
      var clientUpdatedAt = Date.now();
      var ok = persistSaved(storageKey, saved, clientUpdatedAt);
      applyToolboxPresentation(saved);
      publishConfigToFirestore(saved, firestoreApi);
      emit(savedEvt, { config: clone(saved), ok: ok, clientUpdatedAt: clientUpdatedAt });
      return ok;
    },

    importRemoteConfig: function (remote, importOptions) {
      importOptions = importOptions || {};
      var mergedRemote = mergeLocalVisibilityIntoRemoteConfig(remote, saved);
      var next = normalizeConfig(mergedRemote);
      var currentJson = JSON.stringify(normalizeConfig(saved));
      var nextJson = JSON.stringify(next);
      if (currentJson === nextJson) return false;
      saved = clone(next);
      draft = clone(next);
      historyStack = [clone(draft)];
      historyPointer = 0;
      var metaAt = Number(importOptions.clientUpdatedAt);
      if (!isFinite(metaAt) || metaAt <= 0) metaAt = Date.now();
      persistSaved(storageKey, saved, metaAt);
      applyToolboxPresentation(saved);
      emit(savedEvt, { config: clone(saved), ok: true, source: 'firestore', clientUpdatedAt: metaAt });
      return true;
    },

    discardDraft: function () {
      draft = clone(saved);
      historyStack = [clone(draft)];
      historyPointer = 0;
      applyToolboxPresentation(saved);
      emit(draftEvt, { draft: clone(draft) });
    },

    applyToolboxIcons: function (config) { applyToolboxIcons(config || draft); },
    applyToolboxLabels: function (config) { applyToolboxLabels(config || draft); },
    applyToolboxVisibility: function (config) { applyToolboxVisibility(config || draft); },
    applyToolboxPresentation: function (config) { applyToolboxPresentation(config || draft); },
    applyIconToMark: applyIconToMark,
    importPreviewDraft: function (next, recordHistory) {
      draft = normalizeConfig(next);
      if (recordHistory !== false) {
        historyStack = historyStack.slice(0, historyPointer + 1);
        historyStack.push(clone(draft));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        historyPointer = historyStack.length - 1;
      }
      applyToolboxPresentation(draft);
      emit(draftEvt, { draft: clone(draft), preview: true });
      return clone(draft);
    },
    normalizeConfig: normalizeConfig,
    sanitizeConfig: normalizeConfig,
    normalizeItem: normalizeItem,
    normalizeVisible: normalizeVisible,
  };

    return Store;
  }

  global.FACTORY_DEFAULT_FTTH_LAB_CONFIG = FACTORY_DEFAULT_FTTH_LAB_CONFIG;
  global.createLabDeviceConfigStore = createLabDeviceConfigStore;
  global.readLabDeviceStorageMeta = readStorageMeta;
  global.isRemoteLabConfigOlderThanLocal = isRemoteConfigOlderThanLocal;
  global.FtthLabSettings = createLabDeviceConfigStore({
    storageKey: 'ifa_ftth_lab_config',
    eventPrefix: 'ifa:ftth-lab',
    factoryConfig: FACTORY_DEFAULT_FTTH_LAB_CONFIG,
  });
})(typeof window !== 'undefined' ? window : globalThis);
