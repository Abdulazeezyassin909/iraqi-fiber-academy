/**
 * Fiber Optics Anatomy CMS — persisted config + undo/redo.
 * localStorage key: ifa_anatomy_config
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'ifa_anatomy_config';
  var MAX_HISTORY = 60;
  var MAX_MEDIA_CHARS = 1800000;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function defaultMedia3D() {
    return { type: 'procedural', data: '' };
  }

  function defaultMedia2D() {
    return { type: 'default-diagram', data: '' };
  }

  function clipData(src) {
    var value = typeof src === 'string' ? src : '';
    if (value.length > MAX_MEDIA_CHARS) return '';
    return value;
  }

  function makeVariant(id, label, guideText) {
    return {
      id: String(id),
      label: String(label),
      guideText: String(guideText || ''),
      media3D: defaultMedia3D(),
      media2D: defaultMedia2D(),
    };
  }

  function normalizeVariant(raw) {
    var v = raw && typeof raw === 'object' ? raw : {};
    var migrated = migrateLegacyMedia(v);
    return {
      id: String(v.id || ('var_' + Date.now() + '_' + Math.floor(Math.random() * 999))),
      label: String(v.label || 'Variant'),
      guideText: String(v.guideText || ''),
      media3D: migrated.media3D,
      media2D: migrated.media2D,
    };
  }

  function migrateLegacyMedia(item) {
    item = item && typeof item === 'object' ? item : {};
    var media3D = item.media3D && typeof item.media3D === 'object' ? item.media3D : null;
    var media2D = item.media2D && typeof item.media2D === 'object' ? item.media2D : null;
    var legacy = item.media && typeof item.media === 'object' ? item.media : null;
    var out3 = media3D ? {
      type: media3D.type === 'custom-glb' ? 'custom-glb' : 'procedural',
      data: clipData(media3D.data),
    } : defaultMedia3D();
    var out2 = media2D ? {
      type: media2D.type === 'custom-media' ? 'custom-media' : 'default-diagram',
      data: clipData(media2D.data),
    } : defaultMedia2D();
    if (legacy && !media3D && !media2D) {
      var rt = legacy.renderType;
      var src = clipData(legacy.mediaSrc);
      if (rt === 'custom-gltf') {
        out3 = { type: 'custom-glb', data: src };
      } else if (rt === 'image-2d' || rt === 'video') {
        out2 = { type: 'custom-media', data: src };
      }
    }
    return { media3D: out3, media2D: out2 };
  }

  var FACTORY_DEFAULT_ANATOMY_CONFIG = {
    version: 3,
    categories: [
      { id: 'lastmile', label: 'Last Mile Cable' },
      { id: 'ftth', label: 'FTTH Cable' },
      { id: 'other', label: 'Other Components' },
    ],
    items: [
      {
        id: '12', kind: 'cable', categoryId: 'lastmile', label: '12F', badge: '12F',
        sublabel: '2 tubes × 6 strands', capacity: 12, tubeCount: 2, strandsPerTube: 6,
        dualGroup: false, icon: '🧬',
        guideTitle: '12F Cable Anatomy',
        guideText: 'Click the jacket to peel tubes, then click a tube to reveal its standard-color strands.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '24', kind: 'cable', categoryId: 'lastmile', label: '24F', badge: '24F',
        sublabel: '4 tubes × 6 strands', capacity: 24, tubeCount: 4, strandsPerTube: 6,
        dualGroup: false, icon: '🧬',
        guideTitle: '24F Cable Anatomy',
        guideText: 'Last-mile 24F: four loose tubes, six colored strands per tube.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '36', kind: 'cable', categoryId: 'lastmile', label: '36F', badge: '36F',
        sublabel: '6 tubes × 6 strands', capacity: 36, tubeCount: 6, strandsPerTube: 6,
        dualGroup: false, icon: '🧬',
        guideTitle: '36F Cable Anatomy',
        guideText: 'Last-mile 36F: six loose tubes, six colored strands per tube.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '48lm', kind: 'cable', categoryId: 'lastmile', label: '48F [Last Mile]', badge: '48F',
        sublabel: '8 tubes × 6 strands', capacity: 48, tubeCount: 8, strandsPerTube: 6,
        dualGroup: false, icon: '🧬',
        guideTitle: '48F Last Mile Anatomy',
        guideText: '48F last-mile construction: eight tubes × six strands (not feeder 12F tubes).',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '48f', kind: 'cable', categoryId: 'ftth', label: '48F [Feeder]', badge: '48F',
        sublabel: '4 tubes × 12 strands', capacity: 48, tubeCount: 4, strandsPerTube: 12,
        dualGroup: false, icon: '🧬',
        guideTitle: '48F Feeder Anatomy',
        guideText: 'FTTH feeder 48F: four tubes × twelve TIA-598 strands.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '72', kind: 'cable', categoryId: 'ftth', label: '72F', badge: '72F',
        sublabel: '6 tubes × 12 strands', capacity: 72, tubeCount: 6, strandsPerTube: 12,
        dualGroup: false, icon: '🧬',
        guideTitle: '72F Feeder Anatomy',
        guideText: 'FTTH 72F: six tubes × twelve strands.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '144', kind: 'cable', categoryId: 'ftth', label: '144F', badge: '144F',
        sublabel: '12 tubes × 12 strands', capacity: 144, tubeCount: 12, strandsPerTube: 12,
        dualGroup: false, icon: '🧬',
        guideTitle: '144F Feeder Anatomy',
        guideText: 'FTTH 144F: twelve tubes × twelve strands.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: '288', kind: 'cable', categoryId: 'ftth', label: '288F', badge: '288F',
        sublabel: '24 tubes × 12 · T13–T24 mid-stripe', capacity: 288, tubeCount: 24, strandsPerTube: 12,
        dualGroup: true, icon: '🧬',
        guideTitle: '288F Dual-Ring Anatomy',
        guideText: '288F dual concentric rings. Tubes 13–24 use a mid black stripe marker.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      },
      {
        id: 'fdt', kind: 'component', categoryId: 'other', label: 'FDT / FAT', badge: 'FDT',
        sublabel: 'Cabinet & fiber access terminal', icon: '📦',
        guideTitle: 'FDT / FAT',
        guideText: 'Fiber Distribution Terminal and Fiber Access Terminal cabinets.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
        activeVariantId: '144f',
        variants: [
          makeVariant('144f', '144F', '144F FDT/FAT: trays and ports for a 144-fiber distribution cabinet.'),
          makeVariant('288f', '288F', '288F FDT/FAT: higher-density trays for a 288-fiber cabinet.'),
          makeVariant('576f', '576F', '576F FDT/FAT: high-capacity cabinet for large FTTH distribution.'),
        ],
      },
      {
        id: 'splitter', kind: 'component', categoryId: 'other', label: 'PLC Splitter', badge: 'PLC',
        sublabel: 'Input & fan-out ratios', icon: '🔀',
        guideTitle: 'PLC Splitter',
        guideText: 'Passive PLC splitter with selectable split ratios.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
        activeVariantId: '1_8',
        variants: [
          makeVariant('1_2', '1:2', '1:2 PLC splitter with ~3.5 dB insertion loss.'),
          makeVariant('1_4', '1:4', '1:4 PLC splitter with ~7.0 dB insertion loss.'),
          makeVariant('1_8', '1:8 PLC', '1:8 Splitter with ~10.5 dB loss'),
          makeVariant('1_16', '1:16 PLC', '1:16 Splitter with ~13.8 dB loss'),
          makeVariant('1_32', '1:32', '1:32 PLC splitter with ~17.0 dB insertion loss.'),
          makeVariant('1_64', '1:64', '1:64 PLC splitter with ~20.5 dB insertion loss.'),
        ],
      },
      {
        id: 'onu', kind: 'component', categoryId: 'other', label: 'ONU', badge: 'ONU',
        sublabel: 'Subscriber terminal', icon: '📡',
        guideTitle: 'ONU',
        guideText: 'Optical Network Unit at the subscriber premises.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
        activeVariantId: '1ge',
        variants: [
          makeVariant('1ge', '1GE', '1GE ONU: single Gigabit Ethernet subscriber terminal.'),
          makeVariant('4ge_wifi', '4GE+WiFi', '4GE+WiFi ONU: four Ethernet ports plus wireless access.'),
          makeVariant('xpon_stick', 'XPON Stick', 'XPON Stick ONU: compact SFP-style optical terminal.'),
        ],
      },
      {
        id: 'olt', kind: 'component', categoryId: 'other', label: 'OLT', badge: 'OLT',
        sublabel: 'PON line card', icon: '🖥️',
        guideTitle: 'OLT Line Card',
        guideText: 'Optical Line Terminal shelf with PON ports and indicators.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
        activeVariantId: 'pon_card',
        variants: [
          makeVariant('pon_card', 'PON Line Card', 'Optical Line Terminal shelf with PON ports and indicators.'),
        ],
      },
    ],
  };

  function normalizeItem(raw) {
    var item = raw && typeof raw === 'object' ? raw : {};
    var kind = item.kind === 'component' ? 'component' : 'cable';
    var migrated = migrateLegacyMedia(item);
    var icon = String(item.icon || (kind === 'component' ? '📦' : '🧬'));
    if (icon.indexOf('data:image') === 0 && icon.length > MAX_MEDIA_CHARS) {
      icon = kind === 'component' ? '📦' : '🧬';
    }
    var out = {
      id: String(item.id || ('item_' + Date.now())),
      kind: kind,
      categoryId: item.categoryId || (kind === 'component' ? 'other' : 'lastmile'),
      label: String(item.label || 'Untitled'),
      badge: String(item.badge || item.label || ''),
      sublabel: String(item.sublabel || ''),
      icon: icon,
      guideTitle: String(item.guideTitle || item.label || ''),
      guideText: String(item.guideText || ''),
      media3D: migrated.media3D,
      media2D: migrated.media2D,
    };
    if (kind === 'cable') {
      out.capacity = parseInt(item.capacity, 10) || parseInt(out.id, 10) || 12;
      out.tubeCount = Math.max(1, parseInt(item.tubeCount, 10) || 2);
      out.strandsPerTube = parseInt(item.strandsPerTube, 10) === 6 ? 6 : 12;
      out.dualGroup = !!item.dualGroup;
    } else {
      var variants = Array.isArray(item.variants)
        ? item.variants.map(normalizeVariant)
        : [];
      var factoryItem = FACTORY_DEFAULT_ANATOMY_CONFIG.items.filter(function (it) {
        return it.id === out.id && it.kind === 'component';
      })[0];
      if (factoryItem && factoryItem.variants && factoryItem.variants.length &&
          (variants.length === 0 || (variants.length === 1 && variants[0].id === 'default'))) {
        out.variants = factoryItem.variants.map(normalizeVariant);
        out.activeVariantId = factoryItem.activeVariantId || out.variants[0].id;
      } else {
        out.variants = variants;
        out.activeVariantId = String(item.activeVariantId || (variants[0] && variants[0].id) || '');
        if (variants.length && !variants.some(function (v) { return v.id === out.activeVariantId; })) {
          out.activeVariantId = variants[0].id;
        }
      }
    }
    return out;
  }

  function normalizeConfig(raw) {
    var src = raw && typeof raw === 'object' ? raw : {};
    var factory = FACTORY_DEFAULT_ANATOMY_CONFIG;
    var cats = Array.isArray(src.categories) && src.categories.length
      ? src.categories
      : factory.categories;
    var items = Array.isArray(src.items) && src.items.length
      ? src.items.map(normalizeItem)
      : factory.items.map(normalizeItem);
    var seen = {};
    items.forEach(function (it) { seen[it.id] = true; });
    factory.items.forEach(function (fi) {
      if (fi.kind === 'component' && !seen[fi.id]) items.push(normalizeItem(fi));
    });
    return {
      version: 3,
      categories: cats.map(function (c) {
        return {
          id: String((c && c.id) || 'lastmile'),
          label: String((c && c.label) || ''),
        };
      }),
      items: items,
    };
  }

  function loadSaved() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return clone(FACTORY_DEFAULT_ANATOMY_CONFIG);
      return normalizeConfig(JSON.parse(raw));
    } catch (err) {
      return clone(FACTORY_DEFAULT_ANATOMY_CONFIG);
    }
  }

  var saved = loadSaved();
  var draft = clone(saved);
  var historyStack = [clone(draft)];
  var historyPointer = 0;

  function emit(name, detail) {
    try {
      global.dispatchEvent(new CustomEvent(name, { detail: detail || {} }));
    } catch (err) { /* ignore */ }
  }

  function persistSaved() {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch (err) {
      return false;
    }
    return true;
  }

  var Store = {
    STORAGE_KEY: STORAGE_KEY,
    FACTORY_DEFAULT_ANATOMY_CONFIG: FACTORY_DEFAULT_ANATOMY_CONFIG,
    MAX_MEDIA_CHARS: MAX_MEDIA_CHARS,

    getActiveConfig: function () {
      return clone(saved);
    },

    getDraft: function () {
      return clone(draft);
    },

    setDraft: function (next, recordHistory) {
      draft = normalizeConfig(next);
      if (recordHistory !== false) {
        historyStack = historyStack.slice(0, historyPointer + 1);
        historyStack.push(clone(draft));
        if (historyStack.length > MAX_HISTORY) historyStack.shift();
        historyPointer = historyStack.length - 1;
      }
      emit('ifa:anatomy-draft-changed', { draft: clone(draft) });
    },

    replaceItem: function (item, recordHistory) {
      var next = clone(draft);
      var found = false;
      var normalized = normalizeItem(item);
      next.items = next.items.map(function (it) {
        if (it.id === normalized.id) {
          found = true;
          return normalized;
        }
        return it;
      });
      if (!found) next.items.push(normalized);
      Store.setDraft(next, recordHistory);
    },

    addItem: function (kind) {
      var isComp = kind === 'component';
      var id = (isComp ? 'comp_' : 'cable_') + Date.now();
      var item = normalizeItem({
        id: id,
        kind: isComp ? 'component' : 'cable',
        categoryId: isComp ? 'other' : 'lastmile',
        label: isComp ? 'New Component' : 'New Cable',
        sublabel: isComp ? 'Custom component' : '2 tubes × 6 strands',
        capacity: 12,
        tubeCount: 2,
        strandsPerTube: 6,
        guideTitle: isComp ? 'New Component' : 'New Cable Anatomy',
        guideText: 'Describe this item for trainees.',
        media3D: defaultMedia3D(),
        media2D: defaultMedia2D(),
      });
      var next = clone(draft);
      next.items.push(item);
      Store.setDraft(next, true);
      return item.id;
    },

    addVariant: function (itemId) {
      var next = clone(draft);
      var item = next.items.filter(function (it) { return it.id === itemId; })[0];
      if (!item || item.kind !== 'component') return null;
      var variant = makeVariant('var_' + Date.now(), 'New Variant', 'Describe this hardware variant.');
      item.variants = (item.variants || []).concat([variant]);
      item.activeVariantId = variant.id;
      Store.setDraft(next, true);
      return variant.id;
    },

    deleteVariant: function (itemId, variantId) {
      var next = clone(draft);
      var item = next.items.filter(function (it) { return it.id === itemId; })[0];
      if (!item || !item.variants || item.variants.length < 2) return false;
      item.variants = item.variants.filter(function (v) { return v.id !== variantId; });
      if (item.activeVariantId === variantId) item.activeVariantId = item.variants[0].id;
      Store.setDraft(next, true);
      return true;
    },

    setActiveVariant: function (itemId, variantId, persistSavedNow) {
      function apply(cfg) {
        (cfg.items || []).forEach(function (it) {
          if (it.id !== itemId || !it.variants) return;
          if (it.variants.some(function (v) { return v.id === variantId; })) {
            it.activeVariantId = variantId;
          }
        });
      }
      apply(draft);
      apply(saved);
      if (persistSavedNow) persistSaved();
      emit('ifa:anatomy-variant-changed', { itemId: itemId, variantId: variantId });
    },

    deleteItem: function (id) {
      var next = clone(draft);
      var remainingCables = next.items.filter(function (it) {
        return it.kind === 'cable' && it.id !== id;
      });
      if (!remainingCables.length) return false;
      next.items = next.items.filter(function (it) { return it.id !== id; });
      Store.setDraft(next, true);
      return true;
    },

    canUndo: function () { return historyPointer > 0; },
    canRedo: function () { return historyPointer < historyStack.length - 1; },

    undo: function () {
      if (!Store.canUndo()) return false;
      historyPointer -= 1;
      draft = clone(historyStack[historyPointer]);
      emit('ifa:anatomy-draft-changed', { draft: clone(draft) });
      return true;
    },

    redo: function () {
      if (!Store.canRedo()) return false;
      historyPointer += 1;
      draft = clone(historyStack[historyPointer]);
      emit('ifa:anatomy-draft-changed', { draft: clone(draft) });
      return true;
    },

    resetToDefaults: function () {
      Store.setDraft(clone(FACTORY_DEFAULT_ANATOMY_CONFIG), true);
    },

    saveChanges: function () {
      saved = clone(draft);
      var ok = persistSaved();
      emit('ifa:anatomy-config-saved', { config: clone(saved), ok: ok });
      return ok;
    },

    discardDraft: function () {
      draft = clone(saved);
      historyStack = [clone(draft)];
      historyPointer = 0;
      emit('ifa:anatomy-draft-changed', { draft: clone(draft) });
    },
  };

  global.FACTORY_DEFAULT_ANATOMY_CONFIG = FACTORY_DEFAULT_ANATOMY_CONFIG;
  global.FiberAnatomyStore = Store;
})(window);
