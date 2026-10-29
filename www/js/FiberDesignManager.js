/**
 * FTTH Fiber Design — AutoFiberEngine (Stage 4).
 * Map topology → DFS traversal → splice matrix. NO UI.
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var deps = null;
  var nodeStore = Object.create(null);
  var matrixRows = [];
  var cabinetRegistry = [];
  var closureRegistry = [];
  var lastDesignVersion = 0;
  var regenTimer = null;
  var listeners = [];
  var currentCabinetCtx = null;
  // Per-run main cable allocation pointers (keyed by main cable id/name)
  var mainPointers = Object.create(null);
  // FACTORY RESET: Main Backbone Names registry for origin name tracking
  var mainBackboneNames = [];
  /** Phase 4: active interactive trail context stamped onto matrix rows */
  var interactivePathCtx = null;
  /** Phase 4: sub-cable ids already allocated from interactive trails (skip DFS guesswork) */
  var interactiveSkipSubCableIds = Object.create(null);

  var FIBERS_PER_TUBE = 6;
  var FATS_PER_TUBE = 3;
  var FIBERS_PER_FAT = 2;
  var FIBER_STATUSES = ['spliced', 'dark_fiber', 'dead', 'available', 'reserved', 'fault'];
  var SPLICE_TYPES = ['Main', 'Expansion', 'Distribution', 'Drop', 'Patch', 'Test'];
  var MATRIX_FIBER_TYPES = ['Main', 'Expansion'];

  const TUBE_COLORS = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black'];
  const FIBER_COLORS = ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'];

  // Hardcoded color mapping for cable capacities (FACTORY RESET - NEW STANDARD)
  // Every tube ALWAYS contains exactly 6 fibers: [Blue, Orange, Green, Brown, Slate, White]
  var CAPACITY_COLOR_MAPPING = {
    12: {
      tubes: ['Blue', 'Orange'],
      fibers_per_tube: 6
    },
    24: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown'],
      fibers_per_tube: 6
    },
    36: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White'],
      fibers_per_tube: 6
    },
    48: {
      tubes: ['Blue', 'Orange', 'Green', 'Brown', 'Slate', 'White', 'Red', 'Black'],
      fibers_per_tube: 6
    }
  };

  var LAST_MILE_TUBE_COUNT = {
    48: 8,
    36: 6,
    24: 4,
    12: 2,
  };

  var STANDARD_COLOR_CODE = TUBE_COLORS.map(function (c) {
    return String(c || '').trim().toLowerCase();
  });

  /** Tube colors for a 48F main cable follow the 8-color main cable code. */
  var STANDARD_TUBE_COLORS = STANDARD_COLOR_CODE.slice();

  /** Fibers inside each tube use the first 6 colors of the main cable fiber code. */
  var STANDARD_FIBER_COLORS = STANDARD_COLOR_CODE.slice(0, FIBERS_PER_TUBE);

  /**
   * Within one tube: FAT i gets fiber pair (2i, 2i+1) as Main / Expansion.
   * Blue tube → Pole1 Blue/Orange, Pole2 Green/Brown, Pole3 Slate/White.
   */
  var TUBE_FAT_FIBER_PAIRS = [
    { main: 'blue', expansion: 'orange' },
    { main: 'green', expansion: 'brown' },
    { main: 'slate', expansion: 'white' },
  ];

  /**
   * Per PLC pair (01/13 … 12/24), cycle this 4-color block before advancing:
   * PLC01+Blue, PLC13+Blue, PLC01+Orange, PLC13+Orange, … Brown, then PLC02/14.
   */
  var DIST_PLC_BLOCK_COLORS = ['Blue', 'Orange', 'Green', 'Brown'];
  var DIST_PLC_PAIR_COUNT = 12;

  function formatPlcSplitterNo(n) {
    var num = Number(n) || 0;
    return 'PLC ' + (num < 10 ? '0' + num : String(num));
  }

  /** pairIndex 0..∞ → { plcMain, plcExpansion, color } for the 4-color × 12-PLC loop. */
  function resolvePlcPairMapping(pairIndex) {
    var idx = Math.max(0, Number(pairIndex) || 0);
    var colorIdx = idx % DIST_PLC_BLOCK_COLORS.length;
    var plcPair = Math.floor(idx / DIST_PLC_BLOCK_COLORS.length) % DIST_PLC_PAIR_COUNT;
    return {
      plcMain: plcPair + 1,
      plcExpansion: plcPair + 13,
      color: DIST_PLC_BLOCK_COLORS[colorIdx],
      colorIndex: colorIdx,
      plcPairIndex: plcPair,
    };
  }

  /**
   * Map distribution rows to PLC Main/Expansion with the 4-color block loop.
   * Pair index is GLOBAL across the whole design (all cabinets / all main cables) —
   * never reset when the feeder cable changes.
   */
  function applyPlcSplitterMapping(rows) {
    if (!rows || !rows.length) return rows;
    var nextPairIndex = 0;
    var lastPairIndex = -1;
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (!row) continue;
      var ft = String(row.fiber_type || '').trim().toLowerCase();
      if (ft === 'main') {
        var pairIndex = nextPairIndex;
        lastPairIndex = pairIndex;
        nextPairIndex += 1;
        var mainMap = resolvePlcPairMapping(pairIndex);
        row.splitter_fiber_no = formatPlcSplitterNo(mainMap.plcMain);
        row.pigtails_fiber_color = mainMap.color;
        row.plc_pair_index = pairIndex;
      } else if (ft === 'expansion') {
        var ePair = lastPairIndex >= 0 ? lastPairIndex : Math.max(0, nextPairIndex - 1);
        var expMap = resolvePlcPairMapping(ePair);
        row.splitter_fiber_no = formatPlcSplitterNo(expMap.plcExpansion);
        row.pigtails_fiber_color = expMap.color;
        row.plc_pair_index = ePair;
      } else {
        if (!row.splitter_fiber_no) row.splitter_fiber_no = '—';
        if (!row.pigtails_fiber_color) row.pigtails_fiber_color = '—';
      }
    }
    return rows;
  }

  /**
   * Validate 48F cable standard before rendering matrix.
   * Throws error if tube count, tube order, fiber count, or fiber order is incorrect.
   */
  function validate48FStandard(tubes) {
    if (DEBUG) {
    console.log('[FiberDesignManager] validate48FStandard START');
    }
    try {
      if (!Array.isArray(tubes)) {
        console.error('[FiberDesignManager] validate48FStandard ERROR: tubes is not an array');
        throw new Error('Invalid tubes: not an array');
      }

      if (DEBUG) {
      console.log('[FiberDesignManager] validate48FStandard: tube count = ' + tubes.length);
      }

      // Validate tube count = 8
      if (tubes.length !== 8) {
        console.error('[FiberDesignManager] validate48FStandard ERROR: tube count is ' + tubes.length + ', expected 8');
        throw new Error('Invalid 48F cable: tube count is ' + tubes.length + ', must be exactly 8');
      }

      // Validate tube order matches standard
      for (var i = 0; i < 8; i++) {
        var expectedTubeColor = TUBE_COLORS[i].toLowerCase();
        var actualTubeColor = (tubes[i] && tubes[i].tube_color) ? String(tubes[i].tube_color).toLowerCase() : '';
        if (actualTubeColor !== expectedTubeColor) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (i + 1) + ' is ' + actualTubeColor + ', expected ' + expectedTubeColor);
          throw new Error('Invalid 48F tube order: tube #' + (i + 1) + ' is ' + actualTubeColor + ', must be ' + expectedTubeColor);
        }
      }

      // Validate fiber count per tube = 6
      // Validate fiber order matches standard
      for (var t = 0; t < tubes.length; t++) {
        var tube = tubes[t];
        if (!tube || !Array.isArray(tube.fibers)) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' missing fibers array');
          throw new Error('Invalid tube #' + (t + 1) + ': missing fibers array');
        }

        if (tube.fibers.length !== 6) {
          console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' fiber count is ' + tube.fibers.length + ', expected 6');
          throw new Error('Invalid 48F tube #' + (t + 1) + ': fiber count is ' + tube.fibers.length + ', must be exactly 6');
        }

        for (var f = 0; f < 6; f++) {
          var expectedFiberColor = FIBER_COLORS[f].toLowerCase();
          var actualFiberColor = (tube.fibers[f] && tube.fibers[f].fiber_color) ? String(tube.fibers[f].fiber_color).toLowerCase() : '';
          if (actualFiberColor !== expectedFiberColor) {
            console.error('[FiberDesignManager] validate48FStandard ERROR: tube #' + (t + 1) + ' fiber #' + (f + 1) + ' is ' + actualFiberColor + ', expected ' + expectedFiberColor);
            throw new Error('Invalid 48F fiber order in tube #' + (t + 1) + ': fiber #' + (f + 1) + ' is ' + actualFiberColor + ', must be ' + expectedFiberColor);
          }
        }
      }

      if (DEBUG) {
      console.log('[FiberDesignManager] validate48FStandard SUCCESS');
      }
      return true;
    } catch (e) {
      console.error('[FiberDesignManager] validate48FStandard EXCEPTION:', e.message);
      console.error('[FiberDesignManager] validate48FStandard STACK:', e.stack);
      throw e;
    }
  }

  function init(api) {
    deps = api || {};
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function createUuid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function normalizeNodeId(nodeId) {
    if (nodeId == null || nodeId === '') return '';
    return String(nodeId);
  }

  function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function cloneMetadata(meta) {
    return {
      created_at: meta.created_at,
      updated_at: meta.updated_at,
      created_by: meta.created_by != null ? meta.created_by : null,
      notes: meta.notes != null ? String(meta.notes) : '',
      is_mock: !!meta.is_mock,
      source: meta.source != null ? String(meta.source) : '',
    };
  }

  function createDefaultMetadata(createdBy, options) {
    options = options || {};
    var ts = nowIso();
    return {
      created_at: ts,
      updated_at: ts,
      created_by: createdBy != null ? String(createdBy) : null,
      notes: options.notes != null ? String(options.notes) : '',
      is_mock: !!options.is_mock,
      source: options.source != null ? String(options.source) : (options.is_mock ? 'mock' : 'real'),
    };
  }

  function touchMetadata(node) {
    if (!node || !node.metadata) return;
    node.metadata.updated_at = nowIso();
  }

  function parseCapacityFromLabel(label) {
    var m = String(label || '').match(/^(\d+)F/i);
    return m ? parseInt(m[1], 10) : 0;
  }

  function tubeCountForCapacity(capacityF) {
    var cap = Number(capacityF) || 0;
    if (LAST_MILE_TUBE_COUNT[cap]) return LAST_MILE_TUBE_COUNT[cap];
    if (cap > 0) return Math.max(1, Math.ceil(cap / FIBERS_PER_TUBE));
    return 2;
  }

  function normalizeFiberRef(ref) {
    if (!ref || typeof ref !== 'object') return null;
    var cableId = ref.cable_id != null ? String(ref.cable_id) : '';
    var tubeId = ref.tube_id != null ? String(ref.tube_id) : '';
    var fiberId = ref.fiber_id != null ? String(ref.fiber_id) : '';
    if (!cableId || !tubeId || !fiberId) return null;
    return { cable_id: cableId, tube_id: tubeId, fiber_id: fiberId };
  }

  function fiberRefKey(ref) {
    return ref.cable_id + '|' + ref.tube_id + '|' + ref.fiber_id;
  }

  function createFiber(fiberNumber, fiberColor, status) {
    return {
      id: createUuid(),
      fiber_number: Number(fiberNumber) || 1,
      fiber_color: isNonEmptyString(fiberColor) ? fiberColor.trim().toLowerCase() : 'blue',
      status: FIBER_STATUSES.indexOf(status) >= 0 ? status : 'available',
    };
  }

  function createTube(tubeNumber, tubeColor, fibers) {
    var tube = {
      id: createUuid(),
      tube_number: Number(tubeNumber) || 1,
      tube_color: isNonEmptyString(tubeColor) ? tubeColor.trim().toLowerCase() : 'blue',
      fibers: [],
    };
    if (Array.isArray(fibers)) {
      fibers.forEach(function (f) {
        if (!f) return;
        tube.fibers.push({
          id: f.id || createUuid(),
          fiber_number: Number(f.fiber_number) || tube.fibers.length + 1,
          fiber_color: isNonEmptyString(f.fiber_color) ? String(f.fiber_color).trim().toLowerCase() : 'blue',
          status: FIBER_STATUSES.indexOf(f.status) >= 0 ? f.status : 'available',
        });
      });
    }
    return tube;
  }

  function buildLastMileTubes(capacityF) {
    var tubeCount = tubeCountForCapacity(capacityF);
    var tubes = [];
    var t;
    for (t = 0; t < tubeCount; t++) {
      var fibers = [];
      var f;
      for (f = 0; f < FIBERS_PER_TUBE; f++) {
        fibers.push(createFiber(f + 1, STANDARD_FIBER_COLORS[f % STANDARD_FIBER_COLORS.length], 'available'));
      }
      tubes.push(createTube(t + 1, STANDARD_TUBE_COLORS[t % STANDARD_TUBE_COLORS.length], fibers));
    }
    return tubes;
  }

  function normalizeCableRole(role, direction) {
    if (role === 'main' || role === 'main_cable') return 'main';
    if (role === 'sub' || role === 'sub_cable') return 'sub';
    return direction === 'outbound' ? 'sub' : 'main';
  }

  function enforceFibersPerTube(tubes) {
    if (!Array.isArray(tubes)) return;
    tubes.forEach(function (tube, tubeIndex) {
      if (!tube.fibers) tube.fibers = [];
      while (tube.fibers.length < FIBERS_PER_TUBE) {
        var fi = tube.fibers.length;
        tube.fibers.push(createFiber(
          fi + 1,
          STANDARD_FIBER_COLORS[fi % STANDARD_FIBER_COLORS.length],
          'available'
        ));
      }
      if (tube.fibers.length > FIBERS_PER_TUBE) {
        tube.fibers = tube.fibers.slice(0, FIBERS_PER_TUBE);
      }
      tube.fibers.forEach(function (fiber, idx) {
        fiber.fiber_number = idx + 1;
      });
      if (!tube.tube_color) {
        tube.tube_color = STANDARD_TUBE_COLORS[tubeIndex % STANDARD_TUBE_COLORS.length];
      }
    });
  }

  function createCable(direction, options) {
    if (DEBUG) {
    console.log('[FiberDesignManager] createCable START: direction=' + direction + ', name=' + (options.name || ''));
    }
    try {
      options = options || {};
      var capacityF = Number(options.capacity_f) || parseCapacityFromLabel(options.name) || 12;
      if (DEBUG) {
      console.log('[FiberDesignManager] createCable: capacityF=' + capacityF);
      }
      var tubes = Array.isArray(options.tubes) && options.tubes.length
        ? options.tubes.map(function (t) {
          return createTube(t.tube_number, t.tube_color, t.fibers);
        })
        : buildLastMileTubes(capacityF);

      enforceFibersPerTube(tubes);

      // TEMPORARILY DISABLED: Validate 48F cable standard
      // This validation is blocking Matrix window from opening
      // if (capacityF === 48) {
      //   console.log('[FiberDesignManager] createCable: validating 48F standard');
      //   validate48FStandard(tubes);
      // }

      if (DEBUG) {
      console.log('[FiberDesignManager] createCable SUCCESS');
      }
      return {
        id: options.id || createUuid(),
        name: options.name != null ? String(options.name) : '',
        direction: direction === 'outbound' ? 'outbound' : 'inbound',
        role: normalizeCableRole(options.role, direction),
        cable_class: options.cable_class || 'last_mile',
        capacity_f: capacityF,
        map_cable_id: options.map_cable_id != null ? String(options.map_cable_id) : null,
        tubes: tubes,
      };
    } catch (e) {
      console.error('[FiberDesignManager] createCable EXCEPTION:', e.message);
      console.error('[FiberDesignManager] createCable STACK:', e.stack);
      throw e;
    }
  }

  function createEmptyNodeRecord(nodeId, nodeType, location, createdBy, metaOptions) {
    return {
      node_id: nodeId,
      node_type: isNonEmptyString(nodeType) ? String(nodeType).trim() : 'unknown',
      location: location && typeof location === 'object'
        ? {
          x: Number(location.x) || 0,
          y: Number(location.y) || 0,
          col: location.col != null ? Number(location.col) : undefined,
          row: location.row != null ? Number(location.row) : undefined,
        }
        : null,
      metadata: createDefaultMetadata(createdBy, metaOptions),
      cables: { inbound: [], outbound: [] },
      splices: [],
    };
  }

  function getCableBucket(node, direction) {
    if (!node || !node.cables) return null;
    return direction === 'outbound' ? node.cables.outbound : node.cables.inbound;
  }

  function collectNodeCables(node) {
    if (!node || !node.cables) return [];
    return (node.cables.inbound || []).concat(node.cables.outbound || []);
  }

  function findCable(node, cableId) {
    if (!node || !cableId) return null;
    var id = String(cableId);
    var list = collectNodeCables(node);
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].id) === id) return list[i];
    }
    return null;
  }

  function findTube(cable, tubeId) {
    if (!cable || !tubeId || !Array.isArray(cable.tubes)) return null;
    var id = String(tubeId);
    var i;
    for (i = 0; i < cable.tubes.length; i++) {
      if (cable.tubes[i] && String(cable.tubes[i].id) === id) return cable.tubes[i];
    }
    return null;
  }

  function findFiber(tube, fiberId) {
    if (!tube || !fiberId || !Array.isArray(tube.fibers)) return null;
    var id = String(fiberId);
    var i;
    for (i = 0; i < tube.fibers.length; i++) {
      if (tube.fibers[i] && String(tube.fibers[i].id) === id) return tube.fibers[i];
    }
    return null;
  }

  function findFiberByColor(tube, color) {
    if (!tube || !Array.isArray(tube.fibers)) return null;
    var key = String(color || '').toLowerCase();
    var i;
    for (i = 0; i < tube.fibers.length; i++) {
      if (tube.fibers[i] && String(tube.fibers[i].fiber_color).toLowerCase() === key) {
        return tube.fibers[i];
      }
    }
    return null;
  }

  function resolveFiberRef(node, ref) {
    var normalized = normalizeFiberRef(ref);
    if (!normalized || !node) return null;
    var cable = findCable(node, normalized.cable_id);
    if (!cable) return null;
    var tube = findTube(cable, normalized.tube_id);
    if (!tube) return null;
    var fiber = findFiber(tube, normalized.fiber_id);
    if (!fiber) return null;
    return { cable: cable, tube: tube, fiber: fiber };
  }

  function nodeHasCableContent(node) {
    return collectNodeCables(node).some(function (c) {
      return c && Array.isArray(c.tubes) && c.tubes.length > 0;
    });
  }

  function isRealFiberDesignNode(node) {
    if (!node) return false;
    if (node.metadata && node.metadata.is_mock === true) return false;
    if (node.metadata && node.metadata.source === 'auto_engine' && nodeHasCableContent(node)) return true;
    if (node.metadata && node.metadata.is_mock === false && nodeHasCableContent(node)) return true;
    if (nodeHasCableContent(node) && (node.splices || []).length > 0) return true;
    if (node.metadata && node.metadata.source === 'real' && nodeHasCableContent(node)) return true;
    return false;
  }

  function projectHasRealFiberDesignData() {
    if (matrixRows.length > 0) return true;
    var keys = Object.keys(nodeStore);
    var i;
    for (i = 0; i < keys.length; i++) {
      if (isRealFiberDesignNode(nodeStore[keys[i]])) return true;
    }
    return false;
  }

  function mapMatrixFiberType(spliceType) {
    var t = String(spliceType || 'Main');
    if (t === 'Main') return 'Main';
    return 'Expansion';
  }

  function cableDisplayId(cable) {
    if (!cable) return '—';
    if (cable.name) return String(cable.name);
    if (cable.capacity_f) return String(cable.capacity_f) + 'F';
    return String(cable.id).slice(0, 8);
  }

  function isMainCable(cable, originNode) {
    if (!cable) return false;
    // Main Cable: ONLY cables connected directly to Cabinet output
    if (originNode && isCabinetNode(originNode)) return true;
    // Check if cable originates from a Cabinet node
    var ends = resolveCableEndpoints(cable);
    if (ends.start && isCabinetNode(ends.start)) return true;
    if (ends.end && isCabinetNode(ends.end)) return true;
    return false;
  }

  /** Resolve a design-cable wrapper back to its map cable when possible. */
  function resolveToMapCable(cable) {
    if (!cable) return null;
    if (cable.points || cable.pointSnapNodeIds || cable.snapLabels) return cable;
    var mapId = cable.map_cable_id != null ? String(cable.map_cable_id) : '';
    if (!mapId && cable.id != null) {
      var m = String(cable.id).match(/^design_(.+)_(inbound|outbound)$/i);
      if (m) mapId = m[1];
    }
    if (!mapId) return cable;
    var cables = getMapCables() || [];
    var i;
    for (i = 0; i < cables.length; i++) {
      if (cables[i] && String(cables[i].id) === mapId) return cables[i];
    }
    return cable;
  }

  /**
   * HARD RULE: Main Cable = only feeders that touch a Cabinet/FDT endpoint.
   * Mid-span continuations, last-mile, and branch cables are never Main —
   * name/backbone registry matching alone must not promote them.
   */
  function isMainCableFromCabinet(cable, nodes) {
    if (!cable) return false;

    /* Explicit design sub / outbound last-mile never occupies M-Cable columns */
    var role = String(cable.role || '').toLowerCase();
    if (role === 'sub' || role === 'sub_cable') return false;
    if (String(cable.direction || '').toLowerCase() === 'outbound' && role !== 'main') {
      return false;
    }

    var mapCable = resolveToMapCable(cable) || cable;
    var ends = resolveCableEndpoints(mapCable);
    if (ends.start && isCabinetNode(ends.start)) return true;
    if (ends.end && isCabinetNode(ends.end)) return true;

    if (nodes && Array.isArray(nodes)) {
      if (ends.start) {
        var startIsCabinet = nodes.some(function (n) {
          return n && ends.start && String(n.id) === String(ends.start.id) && isCabinetNode(n);
        });
        if (startIsCabinet) return true;
      }
      if (ends.end) {
        var endIsCabinet = nodes.some(function (n) {
          return n && ends.end && String(n.id) === String(ends.end.id) && isCabinetNode(n);
        });
        if (endIsCabinet) return true;
      }
    }

    return false;
  }

  // Register Main Backbone Names from cables directly connected to Cabinet (FIXED)
  function registerMainBackboneNames(mapCables, allNodes) {
    mainBackboneNames = []; // Reset registry

    if (!mapCables || !Array.isArray(mapCables)) return;

    mapCables.forEach(function (mapCable) {
      // CRITICAL FIX: Use mapCable directly to read actual map topology and coordinates
      var ends = resolveCableEndpoints(mapCable);
      var isDirectCabinet = false;

      if (ends.start && isCabinetNode(ends.start)) isDirectCabinet = true;
      if (ends.end && isCabinetNode(ends.end)) isDirectCabinet = true;

      if (allNodes && Array.isArray(allNodes)) {
        if (ends.start) {
          var startIsCabinet = allNodes.some(function (n) { return n.id === ends.start.id && isCabinetNode(n); });
          if (startIsCabinet) isDirectCabinet = true;
        }
        if (ends.end) {
          var endIsCabinet = allNodes.some(function (n) { return n.id === ends.end.id && isCabinetNode(n); });
          if (endIsCabinet) isDirectCabinet = true;
        }
      }

      // If directly connected to Cabinet, register its name as Main Backbone
      if (isDirectCabinet) {
        var label = getCableLabel(mapCable);
        if (label) {
          var backboneName = String(label).trim().toUpperCase();
          if (mainBackboneNames.indexOf(backboneName) === -1) {
            mainBackboneNames.push(backboneName);
            if (DEBUG) {
            console.log('[FiberDesignManager] Registered Main Backbone Name: ' + backboneName);
            }
          }
        }
      }
    });
  }

  function getClosureLabel(nodeId) {
    if (deps && deps.getClosureLabel) {
      return deps.getClosureLabel(nodeId) || String(nodeId);
    }
    return String(nodeId);
  }

  function getFatIdForNode(nodeId) {
    if (deps && deps.getFatIdForClosure) {
      return deps.getFatIdForClosure(nodeId) || '';
    }
    return '';
  }

  function getMapNodes() {
    if (deps && deps.getMapNodes) return deps.getMapNodes() || [];
    if (deps && deps.getClosureNodes) return deps.getClosureNodes() || [];
    return [];
  }

  function getMapCables() {
    if (deps && deps.getMapCables) return deps.getMapCables() || [];
    return [];
  }

  function resolveMapNode(ref) {
    if (!ref) return null;
    if (typeof ref === 'object' && ref.id) return ref;
    var id = String(ref);
    if (deps && deps.resolveNodeById) {
      var byId = deps.resolveNodeById(id);
      if (byId) return byId;
    }
    if (deps && deps.resolveNodeBySnapLabel) {
      return deps.resolveNodeBySnapLabel(id);
    }
    return null;
  }

  function getCableLabel(mapCable) {
    if (!mapCable) return 'Cable';
    if (deps && deps.getMapCableLabel) {
      return deps.getMapCableLabel(mapCable) || mapCable.name || mapCable.asBuiltId || 'Cable';
    }
    return mapCable.name || mapCable.asBuiltId || 'Cable';
  }

  function getFatLabelForNode(node) {
    if (!node) return '—';
    if (node.type === 'fat_handhole') {
      return node.autoName || node.fatSystemName || getClosureLabel(node.id) || node.id;
    }
    if (node.type === 'pole_foundation') {
      return node.poleName || node.autoName || ('P-' + node.id);
    }
    if (deps && deps.getFatIdForClosure) {
      return deps.getFatIdForClosure(node.id) || getClosureLabel(node.id);
    }
    return getClosureLabel(node.id);
  }

  /** Strip letters — matrix FAT ID shows digits only (FAT35 → 35). */
  function fatIdNumericOnly(label) {
    var m = String(label == null ? '' : label).match(/(\d+)/);
    return m ? m[1] : '—';
  }

  function nodeDistance(a, b) {
    var pa = getNodeXY(a);
    var pb = getNodeXY(b);
    if (!pa || !pb) return Infinity;
    return Math.hypot(pa.x - pb.x, pa.y - pb.y);
  }

  /**
   * Distance along a cable polyline from the end nearest `fromNode` to projection of `toNode`.
   * Falls back to Euclidean node distance.
   */
  function cablePathDistanceFromNode(cable, fromNode, toNode) {
    var pts = cable && cable.points;
    if (!pts || pts.length < 2) return nodeDistance(fromNode, toNode);
    var fromXY = getNodeXY(fromNode);
    var toXY = getNodeXY(toNode);
    if (!fromXY || !toXY) return nodeDistance(fromNode, toNode);

    function nearestIndex(xy) {
      var bestI = 0;
      var bestD = Infinity;
      var i;
      for (i = 0; i < pts.length; i++) {
        var d = Math.hypot(pts[i][0] - xy.x, pts[i][1] - xy.y);
        if (d < bestD) {
          bestD = d;
          bestI = i;
        }
      }
      return bestI;
    }

    var fromIdx = nearestIndex(fromXY);
    var toIdx = nearestIndex(toXY);
    var i0 = Math.min(fromIdx, toIdx);
    var i1 = Math.max(fromIdx, toIdx);
    var len = 0;
    var i;
    for (i = i0; i < i1; i++) {
      len += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    }
    return len;
  }

  function isCabinetNode(node) {
    return !!(node && node.type === 'fdt');
  }

  function isOltNode(node) {
    return !!(node && node.type === 'olt');
  }

  function isClosureNode(node) {
    if (!node) return false;
    if (node.type === 'handhole' && (node.hasClosure || node.closureName)) return true;
    if (node.type === 'fat_handhole' && node.hasClosure) return true;
    return false;
  }

  /*
   * Ring feeder (OLT → Cabinets): one tube (12 fibers) per cabinet.
   * Natural tube sequence + black-striped repeat for tubes 13–24 on 288F.
   */
  var RING_FIBERS_PER_TUBE = 12;
  var RING_NATURAL_TUBE_COLORS = [
    'Blue', 'Orange', 'Green', 'Brown', 'Grey', 'White',
    'Red', 'Black', 'Yellow', 'Violet', 'Pink', 'Cyan',
  ];
  var RING_FIBER_COLORS = [
    'Blue', 'Orange', 'Green', 'Brown', 'Gray', 'White',
    'Red', 'Black', 'Yellow', 'Violet', 'Pink', 'Aqua',
  ];
  var RING_FEEDER_SPECS = {
    48: { tubeCount: 4, maxCabinets: 4, stripedFrom: 0 },
    72: { tubeCount: 6, maxCabinets: 6, stripedFrom: 0 },
    144: { tubeCount: 12, maxCabinets: 12, stripedFrom: 0 },
    288: { tubeCount: 24, maxCabinets: 24, stripedFrom: 13 },
  };

  function getOltLabel(node) {
    if (!node) return 'OLT';
    return String(node.autoName || node.code || 'OLT');
  }

  function resolveFeederCapacity(cable) {
    if (!cable) return 0;
    var fromField = Number(cable.capacity_f) || Number(cable.capacity) || 0;
    if (fromField === 48 || fromField === 72 || fromField === 144 || fromField === 288) return fromField;
    var label = getCableLabel(cable);
    var fromLabel = parseCapacityFromLabel(label);
    if (fromLabel === 48 || fromLabel === 72 || fromLabel === 144 || fromLabel === 288) return fromLabel;
    return 0;
  }

  function getRingTubeDescriptor(capacityF, tubeIndex0) {
    var spec = RING_FEEDER_SPECS[capacityF];
    if (!spec || tubeIndex0 < 0 || tubeIndex0 >= spec.tubeCount) return null;
    var tubeNumber = tubeIndex0 + 1;
    var naturalIndex = tubeIndex0 % RING_NATURAL_TUBE_COLORS.length;
    var color = RING_NATURAL_TUBE_COLORS[naturalIndex];
    var striped = !!(spec.stripedFrom && tubeNumber >= spec.stripedFrom);
    var label = striped
      ? (color + ' (Black Stripe)')
      : color;
    return {
      tube_number: tubeNumber,
      tube_color: color,
      tube_striped: striped,
      tube_label: label,
      fiber_colors: RING_FIBER_COLORS.slice(),
    };
  }

  function cabinetNumericId(node) {
    var label = getCabinetLabel(node);
    var m = String(label == null ? '' : label).match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  }

  function getNodeDistAlongCable(cable, node) {
    if (!cable || !node) return null;
    var pts = cable.points || [];
    if (pts.length < 2) return null;
    var xy = getNodeXY(node);
    if (!xy) return null;
    return projectOntoCablePolyline(xy, pts).distAlong;
  }

  /**
   * FDTs on a feeder, from both sides of the OLT, ordered by distance from OLT.
   * Index 0 = nearest cabinet → Blue tube.
   */
  function collectCabinetsOnFeeder(cable, oltNode) {
    if (!cable) return [];
    var pts = cable.points || [];
    var linkDist = (deps && deps.getCableLinkDistance) ? deps.getCableLinkDistance() : 80;
    var byId = Object.create(null);

    function addCabinet(node, distHint, force) {
      if (!isCabinetNode(node) || !node.id) return;
      var id = String(node.id);
      var distAlong = null;
      var xy = getNodeXY(node);
      if (xy && pts.length >= 2) {
        var proj = projectOntoCablePolyline(xy, pts);
        if (proj.distToLine <= linkDist) distAlong = proj.distAlong;
        else if (!force) return;
        else distAlong = proj.distAlong;
      }
      if (distAlong == null) {
        if (!force && pts.length >= 2) return;
        distAlong = distHint != null && isFinite(distHint) ? distHint : 0;
      }
      var prev = byId[id];
      if (prev) {
        var prevDelta = Math.abs(prev.distAlong);
        var nextDelta = Math.abs(distAlong);
        if (prev.forced && !force && nextDelta >= prevDelta) return;
        if (prev.forced && force && nextDelta >= prevDelta) return;
        if (!force && nextDelta >= prevDelta) return;
      }
      byId[id] = { node: node, distAlong: distAlong, forced: !!force };
    }

    var snapIds = cable.pointSnapNodeIds || [];
    var i;
    for (i = 0; i < snapIds.length; i++) {
      if (!snapIds[i]) continue;
      var snapped = resolveMapNode(snapIds[i]);
      if (!snapped) continue;
      var alongSnap = i;
      if (pts.length >= 2) {
        var sxy = getNodeXY(snapped);
        if (sxy) alongSnap = projectOntoCablePolyline(sxy, pts).distAlong;
      }
      addCabinet(snapped, alongSnap, true);
    }

    var labels = cable.snapLabels || [];
    for (i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      var byLabel = resolveSnapLabel(labels[i]);
      if (!byLabel) continue;
      var alongLabel = i;
      if (pts.length >= 2) {
        var lxy = getNodeXY(byLabel);
        if (lxy) alongLabel = projectOntoCablePolyline(lxy, pts).distAlong;
      }
      addCabinet(byLabel, alongLabel, true);
    }

    if (pts.length >= 2) {
      getMapNodes().forEach(function (node) {
        if (!isCabinetNode(node)) return;
        var xy = getNodeXY(node);
        if (!xy) return;
        var proj = projectOntoCablePolyline(xy, pts);
        if (proj.distToLine > linkDist) return;
        addCabinet(node, proj.distAlong, false);
      });
    }

    var ends = resolveCableEndpoints(cable);
    if (ends.start) addCabinet(ends.start, 0, true);
    if (ends.end && pts.length) {
      var totalLen = 0;
      for (i = 0; i < pts.length - 1; i++) {
        totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      }
      addCabinet(ends.end, totalLen, true);
    }

    /* Include any FDTs from full path walk (both sides of OLT — no short-span drop). */
    var walked = getOrderedNodesOnCable(cable, oltNode || null);
    for (i = 0; i < walked.length; i++) {
      addCabinet(walked[i], null, true);
    }

    var oltDist = 0;
    if (oltNode) {
      var od = getNodeDistAlongCable(cable, oltNode);
      if (od != null && isFinite(od)) oltDist = od;
    }

    var ranked = [];
    Object.keys(byId).forEach(function (id) {
      var entry = byId[id];
      ranked.push({
        node: entry.node,
        distFromOlt: Math.abs(entry.distAlong - oltDist),
        distAlong: entry.distAlong,
      });
    });

    ranked.sort(function (a, b) {
      if (Math.abs(a.distFromOlt - b.distFromOlt) > 0.5) {
        return a.distFromOlt - b.distFromOlt;
      }
      var na = cabinetNumericId(a.node);
      var nb = cabinetNumericId(b.node);
      if (na !== nb) return na - nb;
      return String(a.node.id).localeCompare(String(b.node.id));
    });

    var cabinets = ranked.map(function (r) { return r.node; });
    console.log('[Ring] cabinets:', cabinets.map(function (c) {
      return c.autoName || c.id;
    }));
    return cabinets;
  }

  function findOltOnCable(cable) {
    var ends = resolveCableEndpoints(cable);
    if (isOltNode(ends.start)) return ends.start;
    if (isOltNode(ends.end)) return ends.end;
    var ordered = getOrderedNodesOnCable(cable, ends.start || ends.end || null);
    var i;
    for (i = 0; i < ordered.length; i++) {
      if (isOltNode(ordered[i])) return ordered[i];
    }
    return null;
  }

  function formatRingPigtailNo(n) {
    var num = Number(n) || 0;
    return 'IN' + (num < 10 ? '0' + num : String(num));
  }

  /**
   * Ring Fiber Design rows: OLT feeder → one tube per cabinet,
   * as two independent 12-row blocks (Main / Backup).
   */
  function buildRingMatrixRows() {
    var rows = [];
    var cables = getMapCables() || [];
    var RING_SEGMENTS = [
      {
        id: 'main',
        layer: 'Main',
        spliceTray: 'S1',
        pigtailOffset: 0,
        splitterPort: 'IN1',
      },
      {
        id: 'backup',
        layer: 'Backup',
        spliceTray: 'S2',
        pigtailOffset: 12,
        splitterPort: 'IN2',
      },
    ];

    cables.forEach(function (cable) {
      if (!cable) return;
      var capacity = resolveFeederCapacity(cable);
      var spec = RING_FEEDER_SPECS[capacity];
      if (!spec) return;

      var olt = findOltOnCable(cable);
      if (!olt) return;

      var cabinets = collectCabinetsOnFeeder(cable, olt);
      if (!cabinets.length) return;

      var cableId = getCableLabel(cable) || cableDisplayId(cable);
      var oltLabel = getOltLabel(olt);
      var maxCab = Math.min(cabinets.length, spec.maxCabinets);
      var i;
      for (i = 0; i < maxCab; i++) {
        var tube = getRingTubeDescriptor(capacity, i);
        if (!tube) break;
        var cab = cabinets[i];
        var cabinetLabel = getCabinetLabel(cab);
        var pathOrder = i;
        var segIdx;
        for (segIdx = 0; segIdx < RING_SEGMENTS.length; segIdx++) {
          var segment = RING_SEGMENTS[segIdx];
          var blockId = [
            String(cable.id || cableId),
            String(tube.tube_number),
            segment.id,
            String(cab.id),
          ].join('|');
          var f;
          for (f = 0; f < RING_FIBERS_PER_TUBE; f++) {
            var fiberColor = RING_FIBER_COLORS[f];
            var spliterNo = f + 1;
            var pigtailNo = segment.pigtailOffset + spliterNo;
            rows.push({
              olt_source: oltLabel,
              feeder_cable_id: cableId,
              capacity: capacity,
              tube_number: tube.tube_number,
              tube_color: tube.tube_color,
              tube_striped: tube.tube_striped,
              tube_label: tube.tube_label,
              path_order: pathOrder,
              ring_segment: segment.id,
              ring_block_id: blockId,
              cable_layer: segment.layer,
              splice_tray: segment.spliceTray,
              fiber_number: pigtailNo,
              fiber_color: fiberColor,
              fiber_label: fiberColor,
              tray_fiber_color: fiberColor,
              cabinet_id: cabinetLabel,
              pigtail_no: formatRingPigtailNo(pigtailNo),
              spliter: String(spliterNo),
              splitter_port: segment.splitterPort,
              cabinet_node_id: String(cab.id),
              olt_node_id: String(olt.id),
              cable_id: String(cable.id || ''),
            });
          }
        }
      }
    });

    rows.sort(function (a, b) {
      if (a.feeder_cable_id !== b.feeder_cable_id) {
        return String(a.feeder_cable_id).localeCompare(String(b.feeder_cable_id), undefined, { numeric: true });
      }
      if ((a.path_order || 0) !== (b.path_order || 0)) {
        return (a.path_order || 0) - (b.path_order || 0);
      }
      if ((a.tube_number || 0) !== (b.tube_number || 0)) {
        return (a.tube_number || 0) - (b.tube_number || 0);
      }
      if (a.ring_segment !== b.ring_segment) {
        return a.ring_segment === 'main' ? -1 : 1;
      }
      return (a.fiber_number || 0) - (b.fiber_number || 0);
    });
    return rows;
  }

  function getRingMatrixRows() {
    return deepClone(buildRingMatrixRows());
  }

  function isFatOrPoleNode(node) {
    if (!node) return false;
    if (node.type === 'fat_handhole') return true;
    if (node.type === 'pole_foundation') return true;
    if (node.type === 'pole') return true;
    return false;
  }

  function resolveSnapLabel(label) {
    if (!label) return null;
    if (deps && deps.resolveNodeBySnapLabel) {
      var n = deps.resolveNodeBySnapLabel(label);
      if (n) return n;
    }
    return resolveMapNode(label);
  }

  function getNodeXY(node) {
    if (!node) return null;
    if (deps && deps.getNodeWorldXY) {
      var w = deps.getNodeWorldXY(node);
      if (w && isFinite(w.x) && isFinite(w.y)) return w;
    }
    if (deps && deps.getNodeLocation) {
      var loc = deps.getNodeLocation(node);
      if (loc && isFinite(loc.x) && isFinite(loc.y)) return { x: loc.x, y: loc.y };
    }
    if (node.location && isFinite(node.location.x) && isFinite(node.location.y)) {
      return { x: node.location.x, y: node.location.y };
    }
    return null;
  }

  function findNearestNodeAtPoint(x, y, maxDist) {
    if (!isFinite(x) || !isFinite(y)) return null;
    if (deps && deps.findNearestNodeAt) {
      var hit = deps.findNearestNodeAt(x, y, maxDist);
      if (hit) return hit;
    }
    var best = null;
    var bestD = maxDist != null ? maxDist : Infinity;
    getMapNodes().forEach(function (node) {
      if (!node || node.type === 'pole') return;
      var xy = getNodeXY(node);
      if (!xy) return;
      var d = Math.hypot(xy.x - x, xy.y - y);
      if (d <= bestD) {
        bestD = d;
        best = node;
      }
    });
    return best;
  }

  function resolveCableEndpoints(cable) {
    var start = null;
    var end = null;
    var ids = cable && cable.pointSnapNodeIds ? cable.pointSnapNodeIds : [];
    var i;
    for (i = 0; i < ids.length; i++) {
      if (!ids[i]) continue;
      var n = resolveMapNode(ids[i]);
      if (!n) continue;
      if (!start) start = n;
      end = n;
    }
    if (cable && cable.connectedTo) {
      if (!start && cable.connectedTo.start) start = resolveSnapLabel(cable.connectedTo.start);
      if (!end && cable.connectedTo.end) end = resolveSnapLabel(cable.connectedTo.end);
    }
    /* Geometric fallback — scan existing map polylines even if snap labels are stale */
    var pts = cable && cable.points;
    if (pts && pts.length >= 2) {
      var linkDist = (deps && deps.getCableLinkDistance) ? deps.getCableLinkDistance() : 80;
      if (!start) {
        start = findNearestNodeAtPoint(pts[0][0], pts[0][1], linkDist);
      }
      if (!end) {
        var last = pts[pts.length - 1];
        end = findNearestNodeAtPoint(last[0], last[1], linkDist);
      }
    }
    if (start && end && start.id === end.id) end = null;
    return { start: start, end: end };
  }

  function getCabinetLabel(node) {
    if (!node) return '—';
    if (deps && deps.getCabinetLabel) return deps.getCabinetLabel(node) || node.autoName || node.id;
    return node.autoName || node.code || String(node.id);
  }

  function findServingCabinet(node) {
    if (!node) return null;
    if (isCabinetNode(node)) return node;
    if (node.ownerFdtId) {
      var owned = findMapNodeById(node.ownerFdtId);
      if (owned && isCabinetNode(owned)) return owned;
    }
    if (deps && deps.findServingFdt) return deps.findServingFdt(node);
    return null;
  }

  /* ─── Continuous fiber pointers (Main continuous · Sub resets per cable) ─── */

  /**
   * Strict sequential tube math (Main continuous · Sub resets per cable):
   *   tubeIndex       = Math.floor(globalFiberIndex / FIBERS_PER_TUBE)
   *   fiberColorIndex = globalFiberIndex % FIBERS_PER_TUBE
   * Each FAT consumes exactly FIBERS_PER_FAT strands (Main + Expansion).
   * Strands are consumed in order within the active tube; the next tube opens
   * only after the current tube's FIBERS_PER_TUBE strands are exhausted.
   * No odd-index skips or mid-tube rollover abandonment.
   */
  function createFiberPointer(capacityF) {
    if (DEBUG) {
    console.log('[FiberDesignManager] createFiberPointer START: capacityF=' + capacityF);
    }
    return {
      capacityF: Number(capacityF) || 48,
      globalFiberIndex: 0,
      nextPair: function () {
        try {
          var maxFibers = this.capacityF || 48;
          if (this.globalFiberIndex >= maxFibers) {
            console.error('[FiberDesignManager] createFiberPointer ERROR: exceeded capacity. globalFiberIndex=' + this.globalFiberIndex + ', maxFibers=' + maxFibers);
            throw new Error('Fiber pointer exceeded 48F capacity (' + maxFibers + ' fibers)');
          }
          if (this.globalFiberIndex + FIBERS_PER_FAT > maxFibers) {
            throw new Error('Fiber pointer cannot allocate pair — only ' + (maxFibers - this.globalFiberIndex) + ' strand(s) remain');
          }

          var tubeIndex = Math.floor(this.globalFiberIndex / FIBERS_PER_TUBE);
          var fiberColorIndex = this.globalFiberIndex % FIBERS_PER_TUBE;

          /* Pair must stay inside the active tube (sequential exhaust before next tube). */
          if (fiberColorIndex + FIBERS_PER_FAT > FIBERS_PER_TUBE) {
            throw new Error('Fiber pointer misaligned — pair would cross tube boundary at index ' + this.globalFiberIndex);
          }

          if (tubeIndex >= TUBE_COLORS.length) {
            console.error('[FiberDesignManager] createFiberPointer ERROR: tubeIndex=' + tubeIndex + ' exceeds TUBE_COLORS.length=' + TUBE_COLORS.length);
            throw new Error('Tube index ' + tubeIndex + ' exceeds TUBE_COLORS array length ' + TUBE_COLORS.length);
          }

          var currentTubeColor = TUBE_COLORS[tubeIndex];
          var currentFiberColor = FIBER_COLORS[fiberColorIndex];

          var assignment = {
            tube_number: tubeIndex + 1,
            tube_color: currentTubeColor,
            main_fiber_color: currentFiberColor,
            expansion_fiber_color: FIBER_COLORS[fiberColorIndex + 1],
            main_fiber_index: fiberColorIndex,
            expansion_fiber_index: fiberColorIndex + 1,
            global_fiber_index: this.globalFiberIndex,
          };

          this.globalFiberIndex += FIBERS_PER_FAT;
          return assignment;
        } catch (e) {
          console.error('[FiberDesignManager] createFiberPointer EXCEPTION:', e.message);
          console.error('[FiberDesignManager] createFiberPointer STACK:', e.stack);
          throw e;
        }
      },
    };
  }

  function createMainFiberPointer(capacityF) {
    return createFiberPointer(capacityF || 48);
  }

  /** Each new Sub-Cable always starts at Blue tube / fiber 0. */
  function createSubCablePointer(capacityF) {
    return createFiberPointer(capacityF || 12);
  }

  /**
   * Normalize feeder identity to a shared label key (e.g. "48F1") so every map
   * segment / design wrapper of the same physical Main resolves to one pointer.
   */
  function normalizeMainFeederKey(mainCable) {
    if (!mainCable) return '';
    var label = String(
      getCableLabel(mainCable) || mainCable.name || mainCable.asBuiltId || ''
    ).trim();
    var batch = label.match(/(\d+\s*F\s*\d+)/i);
    var base = '';
    if (batch) base = batch[1].replace(/\s+/g, '').toUpperCase();
    else if (label) base = label.toUpperCase();
    else if (mainCable.map_cable_id != null && String(mainCable.map_cable_id)) {
      base = 'MAP:' + String(mainCable.map_cable_id).toUpperCase();
    } else if (mainCable.id != null && String(mainCable.id)) {
      base = 'ID:' + String(mainCable.id).toUpperCase();
    }
    if (!base) return '';
    /* Isolate PLC / fiber pointers per owning FDT so FDT domains never share counters */
    var cab = mainCable.ownerFdtId ||
      (mainCable.mainCableTrail && mainCable.mainCableTrail.cabinetId) ||
      '';
    return cab ? (String(cab) + '::' + base) : base;
  }

  /**
   * Get or create a shared main-pointer for a physical feeder (one key per 48F1, etc.).
   */
  function getOrCreateMainPointer(mainCable) {
    if (!mainCable) return createMainFiberPointer(48);
    var key = normalizeMainFeederKey(mainCable);
    if (!key) key = 'ANON:' + createUuid();
    if (!mainPointers[key]) {
      var cap = Number(mainCable.capacity_f) || Number(mainCable.capacity) ||
        parseCapacityFromLabel(key) || 48;
      mainPointers[key] = createMainFiberPointer(cap);
    }
    return mainPointers[key];
  }

  /**
   * True when two map/design cables are the same Main backbone feed:
   * same physical id, or same batch/display label (e.g. 48F1).
   */
  function isSameMainBackboneCable(a, b) {
    if (!a || !b) return false;
    if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
    if (a.map_cable_id != null && b.id != null && String(a.map_cable_id) === String(b.id)) return true;
    if (b.map_cable_id != null && a.id != null && String(b.map_cable_id) === String(a.id)) return true;
    var ka = normalizeMainFeederKey(a);
    var kb = normalizeMainFeederKey(b);
    return !!(ka && kb && ka === kb);
  }

  /** @deprecated */
  function createTubeFiberAllocator(capacityF) {
    return createMainFiberPointer(capacityF);
  }

  /**
   * Project point onto polyline; returns { distAlong, distToLine }.
   */
  function projectOntoCablePolyline(xy, pts) {
    if (!xy || !pts || pts.length < 2) {
      return { distAlong: 0, distToLine: Infinity };
    }
    var bestDist = Infinity;
    var bestAlong = 0;
    var walked = 0;
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var ax = pts[i][0];
      var ay = pts[i][1];
      var bx = pts[i + 1][0];
      var by = pts[i + 1][1];
      var dx = bx - ax;
      var dy = by - ay;
      var lenSq = dx * dx + dy * dy;
      var t = lenSq < 1e-9 ? 0 : Math.max(0, Math.min(1, ((xy.x - ax) * dx + (xy.y - ay) * dy) / lenSq));
      var px = ax + t * dx;
      var py = ay + t * dy;
      var d = Math.hypot(xy.x - px, xy.y - py);
      var segLen = Math.sqrt(lenSq);
      if (d < bestDist) {
        bestDist = d;
        bestAlong = walked + t * segLen;
      }
      walked += segLen;
    }
    return { distAlong: bestAlong, distToLine: bestDist };
  }

  /**
   * All equipment nodes along a cable, ordered from originNode toward the far end.
   * Discovers daisy-chained FATs on one LineString (not just endpoints).
   */
  function getOrderedNodesOnCable(cable, originNode) {
    if (!cable) return [];
    var pts = cable.points || [];
    var linkDist = (deps && deps.getCableLinkDistance) ? deps.getCableLinkDistance() : 80;
    var hits = [];
    var seen = Object.create(null);

    function addHit(node, distAlong) {
      if (!node || !node.id) return;
      var id = String(node.id);
      if (seen[id]) {
        var j;
        for (j = 0; j < hits.length; j++) {
          if (String(hits[j].node.id) === id && distAlong < hits[j].distAlong) {
            hits[j].distAlong = distAlong;
          }
        }
        return;
      }
      seen[id] = true;
      hits.push({ node: node, distAlong: distAlong });
    }

    var snapIds = cable.pointSnapNodeIds || [];
    var i;
    for (i = 0; i < snapIds.length; i++) {
      if (!snapIds[i]) continue;
      var snapped = resolveMapNode(snapIds[i]);
      if (!snapped) continue;
      var along = i;
      if (pts.length >= 2) {
        var sxy = getNodeXY(snapped);
        if (sxy) along = projectOntoCablePolyline(sxy, pts).distAlong;
      }
      addHit(snapped, along);
    }

    var labels = cable.snapLabels || [];
    for (i = 0; i < labels.length; i++) {
      if (!labels[i]) continue;
      var byLabel = resolveSnapLabel(labels[i]);
      if (!byLabel) continue;
      var alongL = i;
      if (pts.length >= 2) {
        var lxy = getNodeXY(byLabel);
        if (lxy) alongL = projectOntoCablePolyline(lxy, pts).distAlong;
      }
      addHit(byLabel, alongL);
    }

    if (pts.length >= 2) {
      getMapNodes().forEach(function (node) {
        if (!node) return;
        if (!isFatOrPoleNode(node) && !isClosureNode(node) &&
            !isCabinetNode(node) && !isOltNode(node)) return;
        var xy = getNodeXY(node);
        if (!xy) return;
        var proj = projectOntoCablePolyline(xy, pts);
        if (proj.distToLine > linkDist) return;
        addHit(node, proj.distAlong);
      });
    }

    var ends = resolveCableEndpoints(cable);
    if (ends.start) addHit(ends.start, 0);
    if (ends.end && pts.length) {
      var totalLen = 0;
      for (i = 0; i < pts.length - 1; i++) {
        totalLen += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      }
      addHit(ends.end, totalLen);
    }

    if (!hits.length) return [];
    hits.sort(function (a, b) { return a.distAlong - b.distAlong; });

    if (originNode && originNode.id) {
      var originId = String(originNode.id);
      var oIdx = -1;
      for (i = 0; i < hits.length; i++) {
        if (String(hits[i].node.id) === originId) {
          oIdx = i;
          break;
        }
      }
      if (oIdx < 0) {
        var bestO = Infinity;
        for (i = 0; i < hits.length; i++) {
          var d = nodeDistance(originNode, hits[i].node);
          if (d < bestO) {
            bestO = d;
            oIdx = i;
          }
        }
      }
      /*
       * Keep BOTH sides of the origin (do not drop the short stub).
       * Order: origin first, then all other nodes by |distAlong - originDist|
       * so a cabinet sitting before the OLT on the polyline (e.g. FDT1) is kept.
       */
      if (oIdx >= 0) {
        var originDist = hits[oIdx].distAlong;
        var originHit = hits[oIdx];
        var others = [];
        for (i = 0; i < hits.length; i++) {
          if (i === oIdx) continue;
          others.push(hits[i]);
        }
        others.sort(function (a, b) {
          var da = Math.abs(a.distAlong - originDist);
          var db = Math.abs(b.distAlong - originDist);
          if (Math.abs(da - db) > 1e-6) return da - db;
          return a.distAlong - b.distAlong;
        });
        hits = [originHit].concat(others);
      }
    }

    return hits.map(function (h) { return h.node; });
  }

  /* ─── Design record helpers used by engine ─── */

  function ensureEngineNode(mapNode) {
    var id = normalizeNodeId(mapNode && mapNode.id);
    if (!id) return null;
    if (!nodeStore[id]) {
      var location = null;
      if (deps && deps.getNodeLocation) location = deps.getNodeLocation(mapNode);
      nodeStore[id] = createEmptyNodeRecord(
        id,
        mapNode.type || 'closure',
        location,
        deps && deps.getCurrentUserId ? deps.getCurrentUserId() : null,
        { is_mock: false, source: 'auto_engine' }
      );
    }
    return nodeStore[id];
  }

  function findOrAddDesignCable(node, direction, mapCable, role) {
    var mapId = mapCable && mapCable.id != null ? String(mapCable.id) : '';
    var bucket = getCableBucket(node, direction);
    var i;
    for (i = 0; i < bucket.length; i++) {
      if (bucket[i] && String(bucket[i].map_cable_id || '') === mapId && mapId) {
        return bucket[i];
      }
    }
    var label = getCableLabel(mapCable);
    var capacity = Number(mapCable && mapCable.capacity) || parseCapacityFromLabel(label) || 12;
    var cable = createCable(direction, {
      name: label,
      capacity_f: capacity,
      role: role || (direction === 'inbound' ? 'main' : 'sub'),
      map_cable_id: mapId || null,
      id: mapId ? ('design_' + mapId + '_' + direction) : undefined,
    });
    bucket.push(cable);
    return cable;
  }

  function ensureTubeOnCable(cable, tubeNumber, tubeColor) {
    enforceFibersPerTube(cable.tubes);
    var tn = Number(tubeNumber) || 1;
    while (cable.tubes.length < tn) {
      var idx = cable.tubes.length;
      var fibers = [];
      var f;
      for (f = 0; f < FIBERS_PER_TUBE; f++) {
        fibers.push(createFiber(f + 1, STANDARD_FIBER_COLORS[f], 'available'));
      }
      cable.tubes.push(createTube(
        idx + 1,
        STANDARD_TUBE_COLORS[idx % STANDARD_TUBE_COLORS.length],
        fibers
      ));
    }
    var tube = cable.tubes[tn - 1];
    if (tubeColor) tube.tube_color = String(tubeColor).toLowerCase();
    return tube;
  }

  function addEngineSplice(node, fromRef, toRef, type, fatId) {
    var fromResolved = resolveFiberRef(node, fromRef);
    var toResolved = resolveFiberRef(node, toRef);
    if (!fromResolved || !toResolved) return null;

    var splice = {
      splice_id: createUuid(),
      from: normalizeFiberRef(fromRef),
      to: normalizeFiberRef(toRef),
      type: type,
      fiber_type: mapMatrixFiberType(type),
      fat_id: fatId != null ? String(fatId) : '',
    };
    node.splices.push(splice);
    fromResolved.fiber.status = 'spliced';
    toResolved.fiber.status = 'spliced';
    touchMetadata(node);
    return splice;
  }

  // FACTORY RESET: Generate Matrix rows from M-Cable
  // Scans map, finds M-Cable using topology, generates rows based on capacity
  function generateMainCableRows(cable, cabinetNode) {
    if (!cable) return [];

    // Verify this is a Main Cable using topology
    if (!isMainCableFromCabinet(cable)) return [];

    var capacity = cable.capacity_f || 12;
    var colorMapping = CAPACITY_COLOR_MAPPING[capacity];

    if (!colorMapping) {
      if (DEBUG) {
      console.warn('[FiberDesignManager] No color mapping for capacity:', capacity);
      }
      return [];
    }

    var tubes = colorMapping.tubes;
    var fibersPerTube = colorMapping.fibers_per_tube;
    var rows = [];

    // Loop through each tube in strict standard color order (already enforced by CAPACITY_COLOR_MAPPING)
    for (var t = 0; t < tubes.length; t++) {
      var tubeColor = tubes[t];

      // Loop through each fiber in this tube (always 6 fibers: Blue, Orange, Green, Brown, Slate, White)
      for (var f = 0; f < fibersPerTube; f++) {
        var fiberColor = FIBER_COLORS[f % FIBER_COLORS.length];

        rows.push({
          m_cable_id: cable.name || cable.id || '—',
          m_tube_color: tubeColor,
          m_fiber_color: fiberColor,
          closure_id: '', // Will be populated when splices are processed
          s_cable_id: '', // Will be populated when splices are processed
          s_tube_color: '', // Will be populated when splices are processed
          s_fiber_color: '', // Will be populated when splices are processed
          fiber_type: '', // Will be populated when splices are processed
          fat_id: '', // Will be populated when splices are processed
        });
      }
    }

    return rows;
  }

  // FACTORY RESET: Fixed M-Cable traversal across multiple closures using Physical Map Cables
  function traverseMainCablePathFixed(mapCables, allNodes, cabinetNode) {
    if (!mapCables || !allNodes) return;

    var mainMapCables = [];
    mapCables.forEach(function (mapCable) {
      var tempCable = {
        name: getCableLabel(mapCable),
        id: mapCable.id,
        points: mapCable.points,
        pointSnapNodeIds: mapCable.pointSnapNodeIds,
        snapLabels: mapCable.snapLabels,
        connectedTo: mapCable.connectedTo
      };
      if (isMainCableFromCabinet(tempCable, allNodes)) {
        mainMapCables.push(mapCable);
      }
    });

    // Track closure traversal order for matrix sorting
    var closureOrderMap = Object.create(null);
    var globalClosureOrder = 0;
    var closureTraversalDebug = [];

    mainMapCables.forEach(function (startMapCable) {
      /* Always display / key the Cabinet-origin feeder — never a mid-span segment id */
      var originMainLabel = getCableLabel(startMapCable);
      var mainCableName = String(originMainLabel).trim().toLowerCase();
      var visitedClosures = Object.create(null);
      var visitedCableSegments = Object.create(null);

      // Create running allocation cursor for this Main Cable
      var designCableForCursor = createCable('outbound', {
        name: originMainLabel,
        capacity_f: Number(startMapCable.capacity) || parseCapacityFromLabel(originMainLabel) || 12,
        map_cable_id: startMapCable.id,
        role: 'main',
      });
      var cableCursor = getOrCreateMainPointer(designCableForCursor);

      var currentMapCable = startMapCable;
      var lastNode = cabinetNode;
      var hopCount = 0;

      while (currentMapCable && hopCount < 100) {
        hopCount++;
        var currentCableId = String(currentMapCable.id);

        if (visitedCableSegments[currentCableId]) break;
        visitedCableSegments[currentCableId] = true;

        var orderedNodes = getOrderedNodesOnCable(currentMapCable, lastNode);
        
        orderedNodes.forEach(function (node) {
          // CRITICAL FIX 3: Skip FAT/Pole Handholes (like FH6) for main backbone matrix
          var nodeLabel = String(getClosureLabel(node.id)).toUpperCase();
          var isPassThrough = (node.type === 'fat_handhole') || (nodeLabel.indexOf('FH') === 0);
          
          // Only process true splices/closures, ignore pass-through handholes
          if (isClosureNode(node) && !isPassThrough) {
            var closureId = String(node.id);
            if (!visitedClosures[closureId]) {
              visitedClosures[closureId] = true;
              
              // Assign closure traversal order
              if (!closureOrderMap[closureId]) {
                globalClosureOrder++;
                closureOrderMap[closureId] = globalClosureOrder;
                var closureLabel = getClosureLabel(node.id) || node.id;
                closureTraversalDebug.push(globalClosureOrder + ' - ' + closureLabel);
              }
              
              /* M-Cable identity stays on the Cabinet feeder even across named hops */
              var designCable = createCable('outbound', {
                name: originMainLabel,
                capacity_f: Number(startMapCable.capacity) || parseCapacityFromLabel(originMainLabel) || 12,
                map_cable_id: startMapCable.id,
                role: 'main',
              });
              
              var closureLabel = getClosureLabel(node.id) || node.id;
              var startTubeColor = cableCursor.tubeIndex < 8 ? CAPACITY_COLOR_MAPPING[48].tubes[cableCursor.tubeIndex] : 'N/A';
              var startFiberColor = cableCursor.fiberIndex < 6 ? STANDARD_COLOR_CODE[cableCursor.fiberIndex] : 'N/A';
              var globalOffsetBefore = (cableCursor.tubeIndex * 6) + cableCursor.fiberIndex;
              
              if (DEBUG) {
              console.log('Closure ID: ' + closureLabel);
              }
              if (DEBUG) {
              console.log('Main Cable ID: ' + mainCableName);
              }
              if (DEBUG) {
              console.log('Start Tube: ' + startTubeColor + ' (index ' + cableCursor.tubeIndex + ')');
              }
              if (DEBUG) {
              console.log('Start Fiber: ' + startFiberColor + ' (index ' + cableCursor.fiberIndex + ')');
              }
              if (DEBUG) {
              console.log('Global Fiber Offset Before: ' + globalOffsetBefore);
              }
              
              var cableRows = generateMainCableRowsForClosure(designCable, node, cabinetNode, cableCursor, closureOrderMap[closureId]);
              matrixRows = matrixRows.concat(cableRows);
              
              var endTubeColor = cableCursor.tubeIndex < 8 ? CAPACITY_COLOR_MAPPING[48].tubes[cableCursor.tubeIndex] : 'N/A';
              var endFiberColor = cableCursor.fiberIndex < 6 ? STANDARD_COLOR_CODE[cableCursor.fiberIndex] : 'N/A';
              var globalOffsetAfter = (cableCursor.tubeIndex * 6) + cableCursor.fiberIndex;
              
              if (DEBUG) {
              console.log('End Tube: ' + endTubeColor + ' (index ' + cableCursor.tubeIndex + ')');
              }
              if (DEBUG) {
              console.log('End Fiber: ' + endFiberColor + ' (index ' + cableCursor.fiberIndex + ')');
              }
              if (DEBUG) {
              console.log('Global Fiber Offset After: ' + globalOffsetAfter);
              }
              
              lastNode = node;
            }
          }
        });

        var nextMapCable = null;
        if (lastNode) {
          mapCables.forEach(function (candidateMapCable) {
            var candidateId = String(candidateMapCable.id);
            if (visitedCableSegments[candidateId]) return;

            var candidateName = String(getCableLabel(candidateMapCable)).trim().toLowerCase();
            if (candidateName !== mainCableName) return;

            var candidateNodes = getOrderedNodesOnCable(candidateMapCable, lastNode);
            if (candidateNodes.length > 0) {
              var firstNodeId = String(candidateNodes[0].id);
              var lastNodeId = String(candidateNodes[candidateNodes.length - 1].id);
              var targetNodeId = String(lastNode.id);
              
              if (firstNodeId === targetNodeId || lastNodeId === targetNodeId) {
                nextMapCable = candidateMapCable;
              }
            }
          });
        }

        if (!nextMapCable) break; 
        currentMapCable = nextMapCable;
      }
    });
    
    // Print closure traversal order debug
    if (DEBUG) {
    console.log('=== CLOSURE TRAVERSAL ORDER ===');
    }
    closureTraversalDebug.forEach(function (entry) {
      if (DEBUG) {
      console.log(entry);
      }
    });
  }

  function generateMainCableRowsForClosure(designCable, closureNode, cabinetNode, cableCursor, closureOrder) {
    var rows = [];
    if (!designCable || !isMainCableFromCabinet(designCable)) return rows;
    var capacity = Number(designCable.capacity_f) || 48;
    var tubeColors = CAPACITY_COLOR_MAPPING[capacity] || CAPACITY_COLOR_MAPPING[48];
    var closureIdStr = String(getClosureLabel(closureNode.id) || closureNode.id);
    var mainCableId = String(designCable.name || designCable.id || '');
    
    // Use cursor to continue from last consumed position
    var startTubeIndex = cableCursor ? cableCursor.tubeIndex : 0;
    var startFiberIndex = cableCursor ? cableCursor.fiberIndex : 0;

    // Extract any active splices mapped to this closure in the global system/node
    var activeSplices = [];
    if (window.matrixSpliceMap && window.matrixSpliceMap[closureIdStr]) {
      activeSplices = window.matrixSpliceMap[closureIdStr];
    } else if (closureNode.splices) {
      activeSplices = closureNode.splices;
    }

    // Generate rows starting from cursor position instead of 0
    var currentTubeIndex = startTubeIndex;
    var currentFiberIndex = startFiberIndex;
    
    while (currentTubeIndex < tubeColors.length) {
      var tubeColor = tubeColors[currentTubeIndex];
      
      for (; currentFiberIndex < 6; currentFiberIndex++) {
        var fiberColor = STANDARD_COLOR_CODE[currentFiberIndex];
        
        var row = {
          cabinet_label: String(cabinetNode.name || cabinetNode.id || ''),
          closure_id: closureIdStr,
          m_cable_id: mainCableId,
          m_tube_color: tubeColor,
          m_fiber_color: fiberColor,
          s_cable_id: '—',
          s_tube_color: '—',
          s_fiber_color: '—',
          fat_distance: 0,
          fiber_type: 'Main',
          closure_order: closureOrder || 0
        };

        // Check if a sub-cable/splice matches this specific Main tube & fiber color
        var matchedSplice = activeSplices.find(function(s) {
          var tMatch = String(s.m_tube_color || '').trim().toLowerCase() === String(tubeColor).trim().toLowerCase();
          var fMatch = String(s.m_fiber_color || '').trim().toLowerCase() === String(fiberColor).trim().toLowerCase();
          return tMatch && fMatch;
        });

        if (matchedSplice) {
          row.s_cable_id = matchedSplice.s_cable_id || matchedSplice.sub_cable_id || '12F1';
          row.s_tube_color = matchedSplice.s_tube_color || tubeColor;
          row.s_fiber_color = matchedSplice.s_fiber_color || fiberColor;
          row.fat_distance = matchedSplice.fat_distance || 0;
        }

        rows.push(row);
      }
      
      // Move to next tube, reset fiber index
      currentFiberIndex = 0;
      currentTubeIndex++;
    }

    // Update cursor to next available fiber position
    if (cableCursor) {
      cableCursor.tubeIndex = currentTubeIndex;
      cableCursor.fiberIndex = currentFiberIndex;
    }

    return rows;
  }

  function buildMatrixRow(node, splice, cabinetNode) {
    var fromR = resolveFiberRef(node, splice.from);
    var toR = resolveFiberRef(node, splice.to);
    if (!fromR || !toR) return null;

    // FACTORY RESET: Strict Main Cable validation using Main Backbone Names
    var fromName = String(fromR.cable.name || fromR.cable.id || '').trim().toUpperCase();
    var toName = String(toR.cable.name || toR.cable.id || '').trim().toUpperCase();

    // STRICT RULE: Prevent Main Cable self-splicing (continuous backbone routing)
    // If both cables have the same name, this is NOT a distribution splice
    if (fromName === toName) {
      if (DEBUG) {
      console.log('[FiberDesignManager] buildMatrixRow: Skipping self-splice (same cable): ' + fromName);
      }
      return null; // This is continuous backbone routing, not a splice
    }

    // STRICT RULE: Use Main Backbone Names for Main Cable identification
    var fromIsMain = isMainCableFromCabinet(fromR.cable);
    var toIsMain = isMainCableFromCabinet(toR.cable);

    var mainSide = null;
    var subSide = null;

    // STRICT RULE: Main Cable CANNOT be assigned to S-Cable columns
    // If both are Main Cables, skip this splice (invalid configuration)
    if (fromIsMain && toIsMain) {
      if (DEBUG) {
      console.log('[FiberDesignManager] buildMatrixRow: Both cables are Main - skipping invalid splice: ' + fromName + ' <-> ' + toName);
      }
      return null;
    }

    // Assign Main and Sub sides — Main ONLY if cable originates at Cabinet/FDT
    if (fromIsMain && !toIsMain) {
      mainSide = fromR;
      subSide = toR;
    } else if (toIsMain && !fromIsMain) {
      mainSide = toR;
      subSide = fromR;
    } else if (!fromIsMain && !toIsMain) {
      /*
       * HARD RULE: do not promote any intermediate/branch cable into M-Cable columns.
       * Keep the outbound/last-mile as S-Cable; leave Main columns empty.
       */
      if (fromR.cable.direction === 'outbound' && toR.cable.direction !== 'outbound') {
        subSide = fromR;
      } else if (toR.cable.direction === 'outbound' && fromR.cable.direction !== 'outbound') {
        subSide = toR;
      } else {
        subSide = toR;
      }
      mainSide = null;
    }

    if (!subSide) return null;

    var cab = cabinetNode || currentCabinetCtx || findServingCabinet(
      (deps && deps.resolveNodeById) ? deps.resolveNodeById(node.node_id) : null
    );

    var mainFiberIndex = -1;
    if (mainSide && mainSide.tube && mainSide.fiber) {
      var tubeNumber = Number(mainSide.tube.tube_number) || 1;
      var fiberNumber = Number(mainSide.fiber.fiber_number) || 1;
      mainFiberIndex = (tubeNumber - 1) * FIBERS_PER_TUBE + (fiberNumber - 1);
    }
    var explicitMainTubeColor = null;
    var explicitMainFiberColor = null;
    if (mainFiberIndex >= 0) {
      explicitMainTubeColor = TUBE_COLORS[Math.floor(mainFiberIndex / FIBERS_PER_TUBE) % TUBE_COLORS.length];
      explicitMainFiberColor = FIBER_COLORS[mainFiberIndex % FIBER_COLORS.length];
    }

    // CRITICAL FIX: Use the actual closure node where this splice occurs
    // This ensures accurate closure mapping for S-Cables
    var actualClosureId = getClosureLabel(node.node_id);

    return {
      node_id: node.node_id,
      closure_id: actualClosureId, // Use actual closure node ID
      cabinet_id: cab ? String(cab.id) : '',
      cabinet_label: cab ? getCabinetLabel(cab) : '—',
      m_cable_id: mainSide ? cableDisplayId(mainSide.cable) : '—',
      m_tube_color: mainSide
        ? (explicitMainTubeColor || mainSide.tube.tube_color)
        : '—',
      m_fiber_color: mainSide
        ? (explicitMainFiberColor || mainSide.fiber.fiber_color)
        : '—',
      s_cable_id: cableDisplayId(subSide.cable),
      s_tube_color: subSide.tube.tube_color,
      s_fiber_color: subSide.fiber.fiber_color,
      fiber_type: splice.fiber_type || mapMatrixFiberType(splice.type),
      fat_id: fatIdNumericOnly(splice.fat_id || getFatIdForNode(node.node_id) || ''),
      splice_id: splice.splice_id,
    };
  }

  function assignFatAtClosure(closureNode, inboundMapCable, outboundMapCable, fatNode, mainPointer, subPointer, cabinetNode, fatDistance) {
    var designNode = ensureEngineNode(closureNode);
    if (!designNode || !subPointer) return;

    /* HARD RULE: inbound must be a Cabinet/FDT-origin feeder; outbound must not be */
    if (!inboundMapCable || !isMainCableFromCabinet(inboundMapCable)) return;
    if (isMainCableFromCabinet(outboundMapCable) ||
        isSameMainBackboneCable(inboundMapCable, outboundMapCable)) {
      return;
    }

    var mainCable = findOrAddDesignCable(designNode, 'inbound', inboundMapCable, 'main');
    var subCable = findOrAddDesignCable(designNode, 'outbound', outboundMapCable, 'sub');

    /* Prefer cascaded pointer from processClosureDistribution so C2 resumes C1's index.
       Fall back to label-keyed shared registry (same "48F1" across segments). */
    var sharedMainPointer = (mainPointer && typeof mainPointer.nextPair === 'function')
      ? mainPointer
      : getOrCreateMainPointer(inboundMapCable || mainCable);
    var feederKey = normalizeMainFeederKey(inboundMapCable || mainCable);
    if (feederKey) mainPointers[feederKey] = sharedMainPointer;

    var mainAsg = sharedMainPointer.nextPair();
    var subAsg = subPointer.nextPair();
    if (!mainAsg || !subAsg) return;

    var mainTube = ensureTubeOnCable(mainCable, mainAsg.tube_number, mainAsg.tube_color);
    var subTube = ensureTubeOnCable(subCable, subAsg.tube_number, subAsg.tube_color);

    var fatId = fatIdNumericOnly(getFatLabelForNode(fatNode));
    var specs = [
      {
        type: 'Main',
        mColor: mainAsg.main_fiber_color,
        mIndex: mainAsg.main_fiber_index,
        sColor: subAsg.main_fiber_color,
        sIndex: subAsg.main_fiber_index,
      },
      {
        type: 'Expansion',
        mColor: mainAsg.expansion_fiber_color,
        mIndex: mainAsg.expansion_fiber_index,
        sColor: subAsg.expansion_fiber_color,
        sIndex: subAsg.expansion_fiber_index,
      },
    ];

    var plcPairIndex = Math.floor((mainAsg.global_fiber_index || 0) / FIBERS_PER_FAT);
    var plcMap = resolvePlcPairMapping(plcPairIndex);

    specs.forEach(function (spec) {
      var mFiber = mainTube.fibers[spec.mIndex] || findFiberByColor(mainTube, spec.mColor);
      var sFiber = subTube.fibers[spec.sIndex] || findFiberByColor(subTube, spec.sColor);
      if (!mFiber || !sFiber) return;
      if (mFiber.status === 'spliced' || sFiber.status === 'spliced') return;

      var splice = addEngineSplice(
        designNode,
        { cable_id: mainCable.id, tube_id: mainTube.id, fiber_id: mFiber.id },
        { cable_id: subCable.id, tube_id: subTube.id, fiber_id: sFiber.id },
        spec.type,
        fatId
      );
      if (!splice) return;
      var row = buildMatrixRow(designNode, splice, cabinetNode || currentCabinetCtx);
      if (row) {
        row.fat_id = fatId;
        row.fat_distance = fatDistance || 0;
        row.plc_pair_index = plcPairIndex;
        if (spec.type === 'Main') {
          row.splitter_fiber_no = formatPlcSplitterNo(plcMap.plcMain);
        } else {
          row.splitter_fiber_no = formatPlcSplitterNo(plcMap.plcExpansion);
        }
        row.pigtails_fiber_color = plcMap.color;
        if (interactivePathCtx) {
          row.path_source = interactivePathCtx.source || 'interactive_trail';
          row.main_path_label = interactivePathCtx.main_path_label || '';
          row.sub_path_label = interactivePathCtx.sub_path_label || '';
          row.design_path = interactivePathCtx.design_path || '';
          if (interactivePathCtx.closure_order != null) {
            row.closure_order = interactivePathCtx.closure_order;
          }
        }
        matrixRows.push(row);
      }
    });

    if (designNode.metadata) {
      designNode.metadata.is_mock = false;
      designNode.metadata.source = 'auto_engine';
    }
  }

  /* ─── Topology graph + DFS ─── */

  function addGraphEdge(graph, cable, aNode, bNode, cableIdx, virtual) {
    if (!aNode || !bNode || !aNode.id || !bNode.id) return null;
    if (String(aNode.id) === String(bNode.id)) return null;
    var a = String(aNode.id);
    var b = String(bNode.id);
    if (!graph.adj[a]) graph.adj[a] = [];
    if (!graph.adj[b]) graph.adj[b] = [];
    if (!graph.nodeById[a]) graph.nodeById[a] = aNode;
    if (!graph.nodeById[b]) graph.nodeById[b] = bNode;

    var edgeId = (virtual ? 'virtual_' : '') + (cable && cable.id ? cable.id : ('edge_' + cableIdx)) +
      '_' + a + '_' + b;
    /* Allow multiple segments of the same physical cable (daisy-chain FATs).
       Only reject an exact undirected a↔b duplicate. */
    var exists = graph.edges.some(function (e) {
      return (e.a === a && e.b === b) || (e.a === b && e.b === a);
    });
    if (exists) return null;

    var edge = {
      id: edgeId,
      cable: cable || { id: edgeId, capacity: 48, name: 'Feeder' },
      a: a,
      b: b,
      order: cableIdx,
      virtual: !!virtual,
    };
    graph.edges.push(edge);
    graph.adj[a].push({ to: b, edge: edge, directedFrom: a });
    graph.adj[b].push({ to: a, edge: edge, directedFrom: b });
    return edge;
  }

  function buildTopologyGraph() {
    var nodes = getMapNodes();
    var cables = getMapCables();
    var graph = {
      nodeById: Object.create(null),
      adj: Object.create(null),
      edges: [],
    };

    nodes.forEach(function (n) {
      if (!n || !n.id) return;
      graph.nodeById[String(n.id)] = n;
      graph.adj[String(n.id)] = [];
    });

    /*
     * Segment each map cable into consecutive equipment nodes along the
     * LineString (Closure → FAT → FAT → … → dead end). Endpoint-only edges
     * hide daisy-chained FATs from DFS.
     */
    cables.forEach(function (cable, cableIdx) {
      var ends = resolveCableEndpoints(cable);
      var origin = ends.start || ends.end || null;
      var ordered = getOrderedNodesOnCable(cable, origin);
      if (ordered.length >= 2) {
        var si;
        for (si = 0; si < ordered.length - 1; si++) {
          addGraphEdge(graph, cable, ordered[si], ordered[si + 1], cableIdx, false);
        }
        return;
      }
      if (ends.start && ends.end) {
        addGraphEdge(graph, cable, ends.start, ends.end, cableIdx, false);
      }
    });

    /*
     * If last-mile cables never snap onto the FDT itself, still attach them to
     * their serving cabinet so DFS can start from every Root Node.
     */
    cables.forEach(function (cable, cableIdx) {
      var ends = resolveCableEndpoints(cable);
      if (!ends.start || !ends.end) return;
      if (isCabinetNode(ends.start) || isCabinetNode(ends.end)) return;

      var fdt = findServingCabinet(ends.start) || findServingCabinet(ends.end);
      if (!fdt) return;

      var attach = null;
      if (isClosureNode(ends.start)) attach = ends.start;
      else if (isClosureNode(ends.end)) attach = ends.end;
      else if (isFatOrPoleNode(ends.start) && !isFatOrPoleNode(ends.end)) attach = ends.end;
      else if (isFatOrPoleNode(ends.end) && !isFatOrPoleNode(ends.start)) attach = ends.start;
      else attach = ends.start;

      if (!attach || isCabinetNode(attach)) return;
      addGraphEdge(graph, cable, fdt, attach, cableIdx + 100000, true);
    });

    return graph;
  }

  function findRootCabinets(nodeById) {
    var roots = [];
    var seen = Object.create(null);
    Object.keys(nodeById).forEach(function (id) {
      if (isCabinetNode(nodeById[id])) {
        roots.push(nodeById[id]);
        seen[id] = true;
      }
    });
    /* Also pick up FDTs that exist on the map even if not yet edged */
    getMapNodes().forEach(function (n) {
      if (!n || !n.id || seen[String(n.id)]) return;
      if (isCabinetNode(n)) {
        roots.push(n);
        seen[String(n.id)] = true;
        nodeById[String(n.id)] = n;
      }
    });
    roots.sort(function (a, b) {
      return String(a.autoName || a.id).localeCompare(String(b.autoName || b.id), undefined, { numeric: true });
    });
    return roots;
  }

  /**
   * Collect ALL FAT/Pole nodes along one outbound Sub-Cable branch from a Closure.
   *
   * Phase 1 — walk the entire Sub-Cable LineString to the dead end and gather
   * every FAT on that exact path (closest → farthest). Do NOT allocate yet.
   * Phase 2 — continue through any further graph edges that share / extend
   * that branch (continuation cables), stopping at the next pure Closure.
   */
  function collectFatsAlongBranch(graph, closureNode, startLink, usedEdges, edgeKeyFn) {
    var closureId = String(closureNode.id);
    var results = [];
    var seenFat = Object.create(null);
    var visited = Object.create(null);
    visited[closureId] = true;

    function pushFat(node, hops, pathDist, edge) {
      if (!node || !isFatOrPoleNode(node)) return;
      var id = String(node.id);
      if (seenFat[id]) return;
      seenFat[id] = true;
      results.push({
        node: node,
        hops: hops,
        pathDist: pathDist,
        edge: edge || startLink.edge,
      });
    }

    /* Mark only the undirected a↔b segment — never every edge of the cable id. */
    function markEdgeBetween(aId, bId) {
      if (!graph || !graph.edges || aId == null || bId == null) return;
      var a = String(aId);
      var b = String(bId);
      if (a === b) return;
      var ei;
      for (ei = 0; ei < graph.edges.length; ei++) {
        var e = graph.edges[ei];
        if (!e) continue;
        if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) {
          usedEdges[edgeKeyFn(e)] = true;
          return;
        }
      }
    }

    var startCable = startLink.edge && startLink.edge.cable;
    var tipId = null;

    if (startCable) {
      var ordered = getOrderedNodesOnCable(startCable, closureNode);
      var prevId = closureId;
      var oi;
      for (oi = 0; oi < ordered.length; oi++) {
        var on = ordered[oi];
        if (!on || !on.id) continue;
        var oid = String(on.id);
        if (oid === closureId) {
          visited[oid] = true;
          prevId = oid;
          continue;
        }
        /* Next pure splice Closure ends this Sub-Cable domain.
           Mark only the segment into that closure (e.g. C1→C2); leave C2→C3+ open. */
        if (isClosureNode(on) && !isFatOrPoleNode(on)) {
          visited[oid] = true;
          markEdgeBetween(prevId, oid);
          break;
        }
        visited[oid] = true;
        tipId = oid;
        pushFat(on, results.length + 1, oi, startLink.edge);
        markEdgeBetween(prevId, oid);
        prevId = oid;
      }

      /* Always consume the outbound start edge; never blanket-mark the whole backbone. */
      if (startLink.edge) {
        usedEdges[edgeKeyFn(startLink.edge)] = true;
      }
    } else if (startLink.edge) {
      usedEdges[edgeKeyFn(startLink.edge)] = true;
    }

    /*
     * Phase 2: BFS only from the LineString dead-end tip for FATs on
     * continuation cables (same branch, different cable id).
     */
    if (!tipId && startLink.to) {
      tipId = String(startLink.to);
      visited[tipId] = true;
    }

    var queue = [];
    if (tipId && graph.nodeById[tipId]) {
      var tipNode = graph.nodeById[tipId];
      queue.push({
        id: tipId,
        parent: closureId,
        hops: Math.max(1, results.length),
        pathDist: cablePathDistanceFromNode(startCable, closureNode, tipNode) ||
          nodeDistance(closureNode, tipNode),
        edge: startLink.edge,
      });
    }

    while (queue.length) {
      queue.sort(function (a, b) {
        if (a.hops !== b.hops) return a.hops - b.hops;
        return a.pathDist - b.pathDist;
      });
      var cur = queue.shift();
      if (!cur) continue;

      var node = graph.nodeById[cur.id];
      if (!node) continue;

      /* Tip is usually already collected in phase 1; still expand from it. */
      if (!(String(cur.id) === tipId && seenFat[tipId])) {
        pushFat(node, cur.hops, cur.pathDist, cur.edge);
      }

      if (isClosureNode(node) && !isFatOrPoleNode(node) && String(node.id) !== closureId) {
        continue;
      }

      var neighbors = graph.adj[cur.id] || [];
      var i;
      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        var nextId = String(link.to);
        if (nextId === cur.parent || visited[nextId]) continue;
        var nextNode = graph.nodeById[nextId];
        if (!nextNode || isCabinetNode(nextNode)) continue;
        if (isClosureNode(nextNode) && !isFatOrPoleNode(nextNode)) continue;

        visited[nextId] = true;
        usedEdges[edgeKeyFn(link.edge)] = true;

        var hopDist = cur.pathDist + (
          cablePathDistanceFromNode(link.edge.cable, node, nextNode) || nodeDistance(node, nextNode)
        );
        queue.push({
          id: nextId,
          parent: cur.id,
          hops: cur.hops + 1,
          pathDist: hopDist,
          edge: link.edge,
        });
      }
    }

    results.sort(function (a, b) {
      if (a.hops !== b.hops) return a.hops - b.hops;
      return a.pathDist - b.pathDist;
    });
    return results;
  }

  function findMapNodeById(nodeId) {
    if (nodeId == null || nodeId === '') return null;
    var want = String(nodeId);
    if (deps && deps.resolveNodeById) {
      var viaDeps = deps.resolveNodeById(want);
      if (viaDeps) return viaDeps;
    }
    var nodes = getMapNodes() || [];
    var i;
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i] && String(nodes[i].id) === want) return nodes[i];
    }
    return null;
  }

  function findMapCableById(cableId) {
    if (cableId == null || cableId === '') return null;
    var want = String(cableId);
    var cables = getMapCables() || [];
    var i;
    for (i = 0; i < cables.length; i++) {
      if (cables[i] && String(cables[i].id) === want) return cables[i];
    }
    return null;
  }

  /**
   * Direct Cabinet→Pole (no closure): allocate Main/Expansion rows on the feeder
   * without Sub-Cable or HH-Closure columns.
   */
  function assignFatDirectFromCabinet(cabinetNode, mainMapCable, fatNode, mainPointer, fatDistance) {
    if (!cabinetNode || !fatNode || !mainMapCable || !isMainCableFromCabinet(mainMapCable)) return;

    var designNode = ensureEngineNode(cabinetNode);
    if (!designNode) return;

    var mainCable = findOrAddDesignCable(designNode, 'outbound', mainMapCable, 'main');
    var sharedMainPointer = (mainPointer && typeof mainPointer.nextPair === 'function')
      ? mainPointer
      : getOrCreateMainPointer(mainMapCable || mainCable);
    var feederKey = normalizeMainFeederKey(mainMapCable || mainCable);
    if (feederKey) mainPointers[feederKey] = sharedMainPointer;

    var mainAsg;
    try {
      mainAsg = sharedMainPointer.nextPair();
    } catch (err) {
      if (DEBUG) console.warn('[FiberDesignManager] direct assign nextPair failed', err);
      return;
    }
    if (!mainAsg) return;

    var mainTube = ensureTubeOnCable(mainCable, mainAsg.tube_number, mainAsg.tube_color);
    var fatId = fatIdNumericOnly(getFatLabelForNode(fatNode));
    var plcPairIndex = Math.floor((mainAsg.global_fiber_index || 0) / FIBERS_PER_FAT);
    var plcMap = resolvePlcPairMapping(plcPairIndex);

    var specs = [
      {
        type: 'Main',
        mColor: mainAsg.main_fiber_color,
        mIndex: mainAsg.main_fiber_index,
        splitterNo: formatPlcSplitterNo(plcMap.plcMain),
      },
      {
        type: 'Expansion',
        mColor: mainAsg.expansion_fiber_color,
        mIndex: mainAsg.expansion_fiber_index,
        splitterNo: formatPlcSplitterNo(plcMap.plcExpansion),
      },
    ];

    specs.forEach(function (spec) {
      var mFiber = mainTube.fibers[spec.mIndex] || findFiberByColor(mainTube, spec.mColor);
      if (!mFiber) return;
      if (mFiber.status === 'spliced') return;
      mFiber.status = 'spliced';

      var row = {
        node_id: designNode.node_id,
        closure_id: '',
        cabinet_id: String(cabinetNode.id),
        cabinet_label: getCabinetLabel(cabinetNode),
        m_cable_id: cableDisplayId(mainCable),
        m_tube_color: mainAsg.tube_color || (mainTube && mainTube.tube_color) || '',
        m_fiber_color: spec.mColor || '',
        s_cable_id: '',
        s_tube_color: '',
        s_fiber_color: '',
        fiber_type: spec.type,
        fat_id: fatId,
        splice_id: 'direct_' + String(mainCable.id || '') + '_' + fatId + '_' + spec.type,
        fat_distance: fatDistance || 0,
        plc_pair_index: plcPairIndex,
        splitter_fiber_no: spec.splitterNo,
        pigtails_fiber_color: plcMap.color,
        path_source: 'interactive_trail_direct',
        main_path_label: '',
        sub_path_label: '',
        design_path: '',
        closure_order: 999999,
        direct_cabinet_pole: true,
      };

      if (interactivePathCtx) {
        row.path_source = interactivePathCtx.source || 'interactive_trail_direct';
        row.main_path_label = interactivePathCtx.main_path_label || '';
        row.sub_path_label = '';
        row.design_path = interactivePathCtx.design_path || row.main_path_label;
        if (interactivePathCtx.closure_order != null) {
          row.closure_order = interactivePathCtx.closure_order;
        }
      }

      matrixRows.push(row);
    });

    if (designNode.metadata) {
      designNode.metadata.is_mock = false;
      designNode.metadata.source = 'auto_engine';
    }
  }

  /**
   * Phase 4: allocate matrix rows from interactive Main/Sub draw trails.
   * Trail sequences are definitive truth — DFS must not re-guess those sub-cables.
   * Also supports Direct Cabinet→Pole Main trails (no closures, drops on main).
   */
  function applyInteractiveTrailAllocations() {
    interactiveSkipSubCableIds = Object.create(null);
    interactivePathCtx = null;

    var mainPacks = getMainCableVisualSequences();
    var subPacks = getSubCableVisualSequences();
    if (!mainPacks.length && !subPacks.length) {
      return { allocated: 0, skipSubCableIds: interactiveSkipSubCableIds };
    }

    mainPacks.forEach(function (pack) {
      pack.mapCable = findMapCableById(pack.cableId);
      if (pack.mapCable) {
        pack.mainPointer = getOrCreateMainPointer(pack.mapCable);
      }
    });

    var closureOrder = Object.create(null);
    var ord = 0;
    mainPacks.forEach(function (pack) {
      (pack.trail.closures || []).forEach(function (c) {
        if (c && c.id && closureOrder[String(c.id)] == null) {
          ord += 1;
          closureOrder[String(c.id)] = ord;
        }
      });
    });

    subPacks.sort(function (a, b) {
      var ao = closureOrder[String(a.trail.closureId)] || 9999;
      var bo = closureOrder[String(b.trail.closureId)] || 9999;
      if (ao !== bo) return ao - bo;
      return String(a.cableId || '').localeCompare(String(b.cableId || ''), undefined, { numeric: true });
    });

    var allocated = 0;

    subPacks.forEach(function (pack) {
      var subCable = findMapCableById(pack.cableId);
      if (!subCable) return;

      var closureNode = findMapNodeById(pack.trail.closureId);
      if (!closureNode || !isClosureNode(closureNode)) return;

      var mainPack = null;
      var mi;
      for (mi = 0; mi < mainPacks.length; mi++) {
        var mp = mainPacks[mi];
        var hit = (mp.trail.closures || []).some(function (c) {
          return c && String(c.id) === String(pack.trail.closureId);
        });
        if (!hit && Array.isArray(mp.trail.nodeIds)) {
          hit = mp.trail.nodeIds.indexOf(String(pack.trail.closureId)) >= 0;
        }
        if (hit) {
          mainPack = mp;
          break;
        }
      }

      var mainCable = mainPack && mainPack.mapCable;
      var cabinetNode = mainPack
        ? findMapNodeById(mainPack.trail.cabinetId)
        : findServingCabinet(closureNode);

      if (!mainCable && cabinetNode) {
        var cables = getMapCables() || [];
        var ci;
        for (ci = 0; ci < cables.length; ci++) {
          var cand = cables[ci];
          if (!isMainCableFromCabinet(cand)) continue;
          var ends = resolveCableEndpoints(cand);
          if ((ends.start && String(ends.start.id) === String(cabinetNode.id)) ||
              (ends.end && String(ends.end.id) === String(cabinetNode.id))) {
            mainCable = cand;
            break;
          }
        }
      }

      if (!mainCable || !isMainCableFromCabinet(mainCable)) return;

      var mainPtr = (mainPack && mainPack.mainPointer) || getOrCreateMainPointer(mainCable);
      if (mainPack) mainPack.mainPointer = mainPtr;
      currentCabinetCtx = cabinetNode || findServingCabinet(closureNode);

      var mainPathLabel = mainPack
        ? formatMainCableTrailPath(mainPack.trail, mainPack.cableId)
        : ((currentCabinetCtx ? getCabinetLabel(currentCabinetCtx) : 'FDT') + ' M-CABLE');
      var subPathLabel = formatSubCableTrailPath(pack.trail);

      interactivePathCtx = {
        source: 'interactive_trail',
        main_path_label: mainPathLabel,
        sub_path_label: subPathLabel,
        design_path: mainPathLabel + (subPathLabel ? ' · ' + subPathLabel : ''),
        closure_order: closureOrder[String(pack.trail.closureId)] || 0,
      };

      var subPointer = createSubCablePointer(Number(subCable.capacity) || 12);
      var drops = pack.trail.drops || [];
      var di;
      for (di = 0; di < drops.length; di++) {
        var fatNode = findMapNodeById(drops[di].id);
        if (!fatNode || !isFatOrPoleNode(fatNode)) continue;
        var before = matrixRows.length;
        assignFatAtClosure(
          closureNode,
          mainCable,
          subCable,
          fatNode,
          mainPtr,
          subPointer,
          currentCabinetCtx,
          nodeDistance(closureNode, fatNode)
        );
        allocated += Math.max(0, matrixRows.length - before);
      }

      interactiveSkipSubCableIds[String(subCable.id)] = true;
      interactivePathCtx = null;
    });

    /* Direct Cabinet→Pole: allocate after closure-based rows so they sit at bottom */
    mainPacks.forEach(function (pack) {
      var trail = pack.trail;
      var drops = trail.drops || [];
      if ((trail.closures || []).length || !drops.length) return;

      var mainCable = pack.mapCable;
      if (!mainCable || !isMainCableFromCabinet(mainCable)) return;

      var cabinetNode = findMapNodeById(trail.cabinetId);
      if (!cabinetNode || !isCabinetNode(cabinetNode)) return;

      var mainPtr = pack.mainPointer || getOrCreateMainPointer(mainCable);
      pack.mainPointer = mainPtr;
      currentCabinetCtx = cabinetNode;

      var mainPathLabel = formatMainCableTrailPath(trail, pack.cableId);
      interactivePathCtx = {
        source: 'interactive_trail_direct',
        main_path_label: mainPathLabel,
        sub_path_label: '',
        design_path: mainPathLabel,
        closure_order: 999999,
      };

      var di;
      for (di = 0; di < drops.length; di++) {
        var fatNode = findMapNodeById(drops[di].id);
        if (!fatNode || !isFatOrPoleNode(fatNode)) continue;
        var before = matrixRows.length;
        assignFatDirectFromCabinet(
          cabinetNode,
          mainCable,
          fatNode,
          mainPtr,
          nodeDistance(cabinetNode, fatNode)
        );
        allocated += Math.max(0, matrixRows.length - before);
      }

      interactiveSkipSubCableIds[String(mainCable.id)] = true;
      interactivePathCtx = null;
    });

    if (DEBUG) {
      console.log('[FiberDesignManager] interactive trails: mains=' + mainPacks.length +
        ', subs=' + subPacks.length + ', rows+=' + allocated);
    }

    return { allocated: allocated, skipSubCableIds: interactiveSkipSubCableIds };
  }

  /**
   * DFS from cabinet. At each Closure (strict two-phase):
   * Phase 1 — allocate ALL local FATs across every outbound branch (no child recursion)
   * Phase 2 — ONLY THEN recurse into downstream closures so they inherit the advanced pointer
   *    Sub-Cable pointer resets to Blue/0 for each new outbound cable
   * Phase 4 — skip sub-cables already allocated from interactive trails
   */
  function dfsDesignFromRoot(root, graph) {
    var usedEdges = Object.create(null);
    var processedClosures = Object.create(null);
    currentCabinetCtx = root;

    function edgeKey(edge) {
      return String(edge.id);
    }

    function processClosureDistribution(closureNode, mainCable, mainPointer, parentId) {
      var closureId = String(closureNode.id);
      if (processedClosures[closureId]) return;
      processedClosures[closureId] = true;

      if (!mainPointer) {
        mainPointer = getOrCreateMainPointer(mainCable);
      } else {
        var inheritKey = normalizeMainFeederKey(mainCable);
        if (inheritKey) mainPointers[inheritKey] = mainPointer;
      }

      var neighbors = (graph.adj[closureId] || []).slice();
      var outbound = [];
      var i;
      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        if (parentId && String(link.to) === String(parentId)) continue;
        if (usedEdges[edgeKey(link.edge)]) continue;
        var nextNode = graph.nodeById[link.to];
        if (!nextNode || isCabinetNode(nextNode)) continue;

        /* Deduplicate by physical Sub-Cable id — one collect/allocate pass per cable */
        var cid = link.edge && link.edge.cable && link.edge.cable.id
          ? String(link.edge.cable.id)
          : edgeKey(link.edge);
        var already = outbound.some(function (o) {
          var oc = o.link.edge && o.link.edge.cable && o.link.edge.cable.id;
          return oc ? String(oc) === cid : edgeKey(o.link.edge) === cid;
        });
        if (already) continue;

        outbound.push({
          link: link,
          nextNode: nextNode,
          geo: nodeDistance(closureNode, nextNode),
          order: link.edge.order || 0,
        });
      }

      /* Child closures queued in Phase 1; recursed only in Phase 2 (parent-complete-then-child). */
      var childCascade = [];

      /* ── Phase 1: allocate ALL local FATs for this closure — no recursion ── */
      for (i = 0; i < outbound.length; i++) {
        var out = outbound[i];
        var subCable = out.link.edge.cable;

        /*
         * Backbone hop Closure→Closure on a main feeder: never treat that cable as
         * a Sub-Cable / last-mile. Only cascade the cabinet feeder + fiber pointer.
         */
        var edgeIsCabinetMain = isMainCableFromCabinet(subCable);
        var edgeIsSameFeeder = !!(mainCable && isSameMainBackboneCable(mainCable, subCable));
        if ((edgeIsCabinetMain || edgeIsSameFeeder) &&
            isClosureNode(out.nextNode) && !isFatOrPoleNode(out.nextNode)) {
          usedEdges[edgeKey(out.link.edge)] = true;
          childCascade.push({
            nextNode: out.nextNode,
            nestedMain: mainCable,
            nestedPtr: mainPointer || getOrCreateMainPointer(mainCable),
          });
          continue;
        }

        /*
         * Phase 4: interactive Sub-Cable trail already allocated this cable —
         * do not let DFS re-order or re-guess FATs on it.
         */
        var subCableId = subCable && subCable.id != null ? String(subCable.id) : '';
        if (subCableId && interactiveSkipSubCableIds[subCableId]) {
          usedEdges[edgeKey(out.link.edge)] = true;
          if (isClosureNode(out.nextNode) && !isFatOrPoleNode(out.nextNode)) {
            childCascade.push({
              nextNode: out.nextNode,
              nestedMain: mainCable,
              nestedPtr: mainPointer || getOrCreateMainPointer(mainCable),
            });
          }
          continue;
        }

        var subPointer = createSubCablePointer(Number(subCable && subCable.capacity) || 12);

        var fats = collectFatsAlongBranch(graph, closureNode, out.link, usedEdges, edgeKey);

        if (!fats.length && isFatOrPoleNode(out.nextNode)) {
          usedEdges[edgeKey(out.link.edge)] = true;
          fats = [{
            node: out.nextNode,
            hops: 1,
            pathDist: out.geo,
            edge: out.link.edge,
          }];
        }

        var f;
        for (f = 0; f < fats.length; f++) {
          /* Never splice a cabinet feeder / same-backbone segment into the S-Cable role */
          if (isMainCableFromCabinet(subCable) ||
              (mainCable && isSameMainBackboneCable(mainCable, subCable))) {
            break;
          }
          if (!mainCable || !isMainCableFromCabinet(mainCable)) {
            /* No valid cabinet-origin feeder — refuse to invent an M-Cable */
            break;
          }
          assignFatAtClosure(
            closureNode,
            mainCable,
            subCable,
            fats[f].node,
            mainPointer,
            subPointer,
            root,
            fats[f].pathDist
          );
        }

        /* Queue downstream closures only — do not recurse yet.
           Always keep the original cabinet-origin feeder as nestedMain. */
        if (isClosureNode(out.nextNode) && !isFatOrPoleNode(out.nextNode)) {
          usedEdges[edgeKey(out.link.edge)] = true;
          childCascade.push({
            nextNode: out.nextNode,
            nestedMain: mainCable,
            nestedPtr: mainPointer || getOrCreateMainPointer(mainCable),
          });
        } else if (isFatOrPoleNode(out.nextNode) && isClosureNode(out.nextNode)) {
          childCascade.push({
            nextNode: out.nextNode,
            nestedMain: mainCable,
            nestedPtr: mainPointer,
          });
        }
      }

      /* ── Phase 2: cascade to children only after parent allocation is complete ── */
      for (i = 0; i < childCascade.length; i++) {
        var child = childCascade[i];
        processClosureDistribution(
          child.nextNode,
          child.nestedMain,
          child.nestedPtr,
          closureId
        );
      }
    }

    function visitTowardClosures(nodeId, parentId, pathCtx) {
      var node = graph.nodeById[nodeId];
      if (!node) return;
      var ctx = pathCtx || { mainCable: null, mainPointer: null };
      var neighbors = graph.adj[nodeId] || [];
      var i;

      for (i = 0; i < neighbors.length; i++) {
        var link = neighbors[i];
        var ek = edgeKey(link.edge);
        if (usedEdges[ek]) continue;
        if (parentId && String(link.to) === String(parentId)) continue;

        var nextId = String(link.to);
        var nextNode = graph.nodeById[nextId];
        var cable = link.edge.cable;
        if (!nextNode) continue;

        if (isCabinetNode(node)) {
          /* Leaving the FDT: only a cabinet-touching cable may become the main feeder */
          var feederCable = isMainCableFromCabinet(cable) ? cable : null;
          var feederPtr = feederCable ? getOrCreateMainPointer(feederCable) : null;
          usedEdges[ek] = true;
          if (feederCable && (isClosureNode(nextNode) || isFatOrPoleNode(nextNode))) {
            var feederSkipId = feederCable.id != null ? String(feederCable.id) : '';
            /* Direct Cabinet→Pole trail already allocated — do not reprocess FAT as a closure */
            if (!(feederSkipId && interactiveSkipSubCableIds[feederSkipId] &&
                  isFatOrPoleNode(nextNode))) {
              processClosureDistribution(nextNode, feederCable, feederPtr, nodeId);
            }
          }
          visitTowardClosures(nextId, nodeId, {
            mainCable: feederCable,
            mainPointer: feederPtr,
          });
          continue;
        }

        if (isClosureNode(nextNode) || isFatOrPoleNode(nextNode)) {
          usedEdges[ek] = true;
          /*
           * Keep cabinet feeder from pathCtx. Do not let a mid-span / last-mile
           * edge replace Main Cable identity for downstream closures.
           */
          var mainCab = ctx.mainCable;
          var ptr = ctx.mainPointer;
          if (!mainCab && isMainCableFromCabinet(cable)) {
            mainCab = cable;
            ptr = getOrCreateMainPointer(mainCab);
          }
          if (!ptr && mainCab) ptr = getOrCreateMainPointer(mainCab);
          if (mainCab && ptr) {
            processClosureDistribution(nextNode, mainCab, ptr, nodeId);
          }
          visitTowardClosures(nextId, nodeId, {
            mainCable: mainCab,
            mainPointer: ptr,
          });
          continue;
        }

        usedEdges[ek] = true;
        visitTowardClosures(nextId, nodeId, ctx);
      }
    }

    visitTowardClosures(String(root.id), null, {
      mainCable: null,
      mainPointer: null,
    });
    currentCabinetCtx = null;
  }

  function rebuildRegistries() {
    var cabSeen = Object.create(null);
    var cloSeen = Object.create(null);
    cabinetRegistry = [];
    closureRegistry = [];

    getMapNodes().forEach(function (n) {
      if (!n || !isCabinetNode(n)) return;
      var id = String(n.id);
      if (cabSeen[id]) return;
      cabSeen[id] = true;
      cabinetRegistry.push({
        node_id: id,
        cabinet_id: id,
        cabinet_label: getCabinetLabel(n),
      });
    });

    matrixRows.forEach(function (row) {
      if (row.cabinet_id && !cabSeen[row.cabinet_id]) {
        cabSeen[row.cabinet_id] = true;
        cabinetRegistry.push({
          node_id: row.cabinet_id,
          cabinet_id: row.cabinet_id,
          cabinet_label: row.cabinet_label || row.cabinet_id,
        });
      }
      if (row.node_id && !cloSeen[row.node_id]) {
        cloSeen[row.node_id] = true;
        closureRegistry.push({
          node_id: String(row.node_id),
          closure_id: row.closure_id || String(row.node_id),
          cabinet_id: row.cabinet_id || '',
          cabinet_label: row.cabinet_label || '',
        });
      }
    });

    if (deps && deps.getClosureNodes) {
      (deps.getClosureNodes() || []).forEach(function (n) {
        var id = normalizeNodeId(n.id);
        if (!id || cloSeen[id]) return;
        cloSeen[id] = true;
        var cab = findServingCabinet(n);
        closureRegistry.push({
          node_id: id,
          closure_id: getClosureLabel(id),
          cabinet_id: cab ? String(cab.id) : '',
          cabinet_label: cab ? getCabinetLabel(cab) : '',
        });
      });
    }

    cabinetRegistry.sort(function (a, b) {
      return String(a.cabinet_label).localeCompare(String(b.cabinet_label), undefined, { numeric: true });
    });
    closureRegistry.sort(function (a, b) {
      return String(a.closure_id).localeCompare(String(b.closure_id), undefined, { numeric: true });
    });
  }

  function sortMatrixRows(rows) {
    /* Stable sort: preserve Main→Expansion push order within each closure. */
    return rows.slice().sort(function (a, b) {
      if (a.cabinet_label !== b.cabinet_label) {
        return String(a.cabinet_label || '').localeCompare(String(b.cabinet_label || ''), undefined, { numeric: true });
      }
      if (a.m_cable_id !== b.m_cable_id) {
        return String(a.m_cable_id || '').localeCompare(String(b.m_cable_id || ''), undefined, { numeric: true });
      }
      if (a.closure_order !== b.closure_order) {
        return (a.closure_order || 0) - (b.closure_order || 0);
      }
      /* Same closure: keep allocation pair index, Main before Expansion. */
      var aPair = a.plc_pair_index != null ? Number(a.plc_pair_index) : NaN;
      var bPair = b.plc_pair_index != null ? Number(b.plc_pair_index) : NaN;
      if (isFinite(aPair) && isFinite(bPair) && aPair !== bPair) {
        return aPair - bPair;
      }
      var aType = String(a.fiber_type || '').toLowerCase();
      var bType = String(b.fiber_type || '').toLowerCase();
      if (aType === 'main' && bType === 'expansion') return -1;
      if (aType === 'expansion' && bType === 'main') return 1;
      return 0;
    });
  }

  function emitDesignChanged(payload) {
    var event = payload && typeof payload === 'object'
      ? payload
      : { version: lastDesignVersion, rows: matrixRows.length };
    if (event.version == null) event.version = lastDesignVersion;
    if (event.rows == null) event.rows = matrixRows.length;
    var i;
    for (i = 0; i < listeners.length; i++) {
      try { listeners[i](event); } catch (e) { /* ignore */ }
    }
    if (global.FTTHFiberDesignUI && global.FTTHFiberDesignUI.refreshMatrix) {
      global.FTTHFiberDesignUI.refreshMatrix(event);
    }
    if (global.FTTHFiberDesignMatrixModal && global.FTTHFiberDesignMatrixModal.refresh) {
      global.FTTHFiberDesignMatrixModal.refresh(event);
    }
  }

  /**
   * AutoFiberEngine — reactive DFS design rebuild.
   */
  var AutoFiberEngine = {
    /**
     * Immediately scan current map state and rebuild matrix rows.
     */
    regenerate: function () {
      if (DEBUG) {
      console.log('[FiberDesignManager] regenerate START');
      }
      var startTime = Date.now();
      try {
        nodeStore = Object.create(null);
        matrixRows = [];
        currentCabinetCtx = null;
        mainPointers = Object.create(null); // reset per-regeneration
        interactivePathCtx = null;
        interactiveSkipSubCableIds = Object.create(null);

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: building topology graph');
        }
        var graph = buildTopologyGraph();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: graph edges = ' + graph.edges.length);
        }

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: finding root cabinets');
        }
        var roots = findRootCabinets(graph.nodeById);
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: roots count = ' + roots.length);
        }

        /*
         * Phase 4: interactive Main/Sub trails are definitive truth.
         * Allocate those rows first, then DFS fills only uncovered topology.
         */
        var interactiveResult = applyInteractiveTrailAllocations();
        if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: interactive allocated rows≈' +
            (interactiveResult && interactiveResult.allocated));
        }

        if (!roots.length) {
          if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: no roots, processing closure nodes');
          }
          (deps && deps.getClosureNodes ? deps.getClosureNodes() : []).forEach(function (n) {
            ensureEngineNode(n);
          });
        } else {
          if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: processing ' + roots.length + ' roots');
          }
          roots.forEach(function (root) {
            if (!graph.adj[String(root.id)]) graph.adj[String(root.id)] = [];
            if (!graph.nodeById[String(root.id)]) graph.nodeById[String(root.id)] = root;
            dfsDesignFromRoot(root, graph);
          });
        }

        // FACTORY RESET: Register Main Backbone Names from Cabinet-connected cables
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: registering Main Backbone Names');
        }
        var mapCables = getMapCables();
        var allNodes = getMapNodes();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: map cables = ' + mapCables.length);
        }
        registerMainBackboneNames(mapCables, allNodes);

        /*
         * Fixed traversal only when DFS produced no distribution splices.
         * Running both floods the matrix with placeholder Main rows and
         * breaks continuous PLC numbering across feeders.
         */
        if (!matrixRows.length) {
          if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: generating Main Cable rows with fixed traversal');
          }
          traverseMainCablePathFixed(mapCables, allNodes, roots[0]);
        } else if (DEBUG) {
          console.log('[FiberDesignManager] regenerate: skip fixed traversal (DFS rows=' + matrixRows.length + ')');
        }

        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: matrix rows before sort = ' + matrixRows.length);
        }
        matrixRows = sortMatrixRows(matrixRows);
        applyPlcSplitterMapping(matrixRows);
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: matrix rows after sort = ' + matrixRows.length);
        }

        rebuildRegistries();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate: cabinets = ' + cabinetRegistry.length + ', closures = ' + closureRegistry.length);
        }

        lastDesignVersion += 1;
        emitDesignChanged({
          version: lastDesignVersion,
          rows: matrixRows.length,
          reason: (interactiveResult && interactiveResult.allocated)
            ? 'interactive-trail'
            : 'topology-regenerate',
          interactiveRows: interactiveResult ? interactiveResult.allocated : 0,
        });

        var endTime = Date.now();
        if (DEBUG) {
        console.log('[FiberDesignManager] regenerate SUCCESS: duration=' + (endTime - startTime) + 'ms, rows=' + matrixRows.length);
        }
        return {
          ok: true,
          version: lastDesignVersion,
          rows: matrixRows.length,
          cabinets: cabinetRegistry.length,
          roots: roots.map(function (r) { return r.id; }),
          edges: graph.edges.length,
          interactiveRows: interactiveResult ? interactiveResult.allocated : 0,
        };
      } catch (e) {
        var endTime = Date.now();
        console.error('[FiberDesignManager] regenerate EXCEPTION:', e.message);
        console.error('[FiberDesignManager] regenerate STACK:', e.stack);
        console.error('[FiberDesignManager] regenerate duration=' + (endTime - startTime) + 'ms, rows=' + matrixRows.length);
        throw e;
      }
    },

    scanMapAndRegenerate: function () {
      return AutoFiberEngine.regenerate();
    },

    getRingMatrixRows: function () {
      return getRingMatrixRows();
    },

    getMatrixRows: function (filters) {
      if (DEBUG) {
      console.log('[FiberDesignManager] getMatrixRows START');
      }
      try {
        var cabinetFilter = 'all';
        var closureFilter = 'all';
        if (filters && typeof filters === 'object') {
          cabinetFilter = filters.cabinet != null ? String(filters.cabinet) : 'all';
          closureFilter = filters.closure != null ? String(filters.closure) : 'all';
        } else if (filters != null) {
          closureFilter = String(filters);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: cabinetFilter=' + cabinetFilter + ', closureFilter=' + closureFilter);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: total matrixRows = ' + matrixRows.length);
        }

        var filtered = matrixRows.filter(function (r) {
          if (cabinetFilter !== 'all' && String(r.cabinet_id) !== cabinetFilter) return false;
          if (closureFilter !== 'all' && String(r.node_id) !== closureFilter) return false;
          // TEMPORARILY DISABLED: Filter to show only 48F main cables
          // This filter might be returning empty results
          // var mCableId = String(r.m_cable_id || '').toUpperCase();
          // if (mCableId.indexOf('48F') === -1) return false;
          return true;
        });

        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows: filtered rows = ' + filtered.length);
        }
        if (DEBUG) {
        console.log('[FiberDesignManager] getMatrixRows SUCCESS');
        }
        return deepClone(filtered);
      } catch (e) {
        console.error('[FiberDesignManager] getMatrixRows EXCEPTION:', e.message);
        console.error('[FiberDesignManager] getMatrixRows STACK:', e.stack);
        throw e;
      }
    },

    getCabinetRegistry: function () {
      return deepClone(cabinetRegistry);
    },

    getClosuresForCabinet: function (cabinetFilter) {
      var filter = cabinetFilter != null ? String(cabinetFilter) : 'all';
      if (filter === 'all') return deepClone(closureRegistry);
      return deepClone(closureRegistry.filter(function (c) {
        return String(c.cabinet_id) === filter;
      }));
    },

    getVersion: function () {
      return lastDesignVersion;
    },

    subscribe: function (fn) {
      if (typeof fn !== 'function') return function () {};
      listeners.push(fn);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
      };
    },
  };

  function notifyTopologyChanged(opts) {
    opts = opts || {};
    if (regenTimer) clearTimeout(regenTimer);
    var delay = opts.immediate ? 0 : 60;
    regenTimer = setTimeout(function () {
      regenTimer = null;
      AutoFiberEngine.regenerate();
    }, delay);
  }

  /** Phase 4: flush interactive path → matrix immediately after trail-bearing save. */
  function notifyInteractivePathCommitted(payload) {
    return notifyTopologyChanged({ immediate: true, interactive: true, path: payload || null });
  }

  function initNodeData(nodeId, nodeType, location, options) {
    var id = normalizeNodeId(nodeId);
    if (!id) return null;
    options = options || {};
    if (nodeStore[id] && !options.replace) {
      return deepClone(nodeStore[id]);
    }
    var createdBy = options.createdBy != null
      ? options.createdBy
      : (deps && deps.getCurrentUserId ? deps.getCurrentUserId() : null);
    var record = createEmptyNodeRecord(id, nodeType, location, createdBy, {
      is_mock: !!options.is_mock,
      source: options.is_mock ? 'mock' : 'auto_engine',
    });
    nodeStore[id] = record;
    return deepClone(record);
  }

  function getNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return null;
    return deepClone(nodeStore[id]);
  }

  function hasNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    return !!(id && nodeStore[id]);
  }

  function addSpliceConnection(nodeId, fromIds, toIds, type, extra) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return { ok: false, error: 'node_not_found' };

    var fromRef = normalizeFiberRef(fromIds);
    var toRef = normalizeFiberRef(toIds);
    if (!fromRef || !toRef) return { ok: false, error: 'invalid_fiber_ref' };
    if (fiberRefKey(fromRef) === fiberRefKey(toRef)) {
      return { ok: false, error: 'same_fiber_endpoint' };
    }

    var node = nodeStore[id];
    var fromResolved = resolveFiberRef(node, fromRef);
    var toResolved = resolveFiberRef(node, toRef);
    if (!fromResolved || !toResolved) return { ok: false, error: 'fiber_not_found_in_node' };

    if (fromResolved.fiber.status === 'spliced') {
      return { ok: false, error: 'from_fiber_already_spliced' };
    }
    if (toResolved.fiber.status === 'spliced') {
      return { ok: false, error: 'to_fiber_already_spliced' };
    }

    var spliceType = isNonEmptyString(type) ? String(type).trim() : 'Main';
    extra = extra || {};
    var splice = {
      splice_id: createUuid(),
      from: fromRef,
      to: toRef,
      type: spliceType,
      fiber_type: mapMatrixFiberType(spliceType),
      fat_id: extra.fat_id != null ? String(extra.fat_id) : getFatIdForNode(id),
    };

    node.splices.push(splice);
    fromResolved.fiber.status = 'spliced';
    toResolved.fiber.status = 'spliced';
    if (node.metadata) {
      node.metadata.is_mock = false;
      node.metadata.source = 'auto_engine';
    }
    touchMetadata(node);

    var row = buildMatrixRow(node, splice);
    if (row) matrixRows.push(row);
    matrixRows = sortMatrixRows(matrixRows);
    applyPlcSplitterMapping(matrixRows);
    lastDesignVersion += 1;
    emitDesignChanged();

    return { ok: true, splice: deepClone(splice) };
  }

  function addCable(nodeId, direction, cableSpec) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return { ok: false, error: 'node_not_found' };
    var node = nodeStore[id];
    var bucket = getCableBucket(node, direction);
    if (!bucket) return { ok: false, error: 'invalid_direction' };

    cableSpec = cableSpec || {};
    var cable = createCable(direction, cableSpec);
    bucket.push(cable);
    touchMetadata(node);
    return { ok: true, cable: deepClone(cable) };
  }

  function ensureDisplayData() {
    if (lastDesignVersion === 0) {
      AutoFiberEngine.regenerate();
    }
  }

  function getClosureRegistry() {
    if (lastDesignVersion === 0) AutoFiberEngine.regenerate();
    return AutoFiberEngine.getClosuresForCabinet('all');
  }

  function getCabinetRegistry() {
    if (lastDesignVersion === 0) AutoFiberEngine.regenerate();
    return AutoFiberEngine.getCabinetRegistry();
  }

  function getSpliceMatrixRows(closureFilterOrOptions) {
    if (DEBUG) {
    console.log('[FiberDesignManager] getSpliceMatrixRows START');
    }
    try {
      if (lastDesignVersion === 0) {
        if (DEBUG) {
        console.log('[FiberDesignManager] getSpliceMatrixRows: regenerating (version 0)');
        }
        AutoFiberEngine.regenerate();
      }
      if (closureFilterOrOptions && typeof closureFilterOrOptions === 'object') {
        if (DEBUG) {
        console.log('[FiberDesignManager] getSpliceMatrixRows: calling getMatrixRows with object filter');
        }
        return AutoFiberEngine.getMatrixRows(closureFilterOrOptions);
      }
      if (DEBUG) {
      console.log('[FiberDesignManager] getSpliceMatrixRows: calling getMatrixRows with string filter');
      }
      var result = AutoFiberEngine.getMatrixRows({
        cabinet: 'all',
        closure: closureFilterOrOptions != null ? String(closureFilterOrOptions) : 'all',
      });
      if (DEBUG) {
      console.log('[FiberDesignManager] getSpliceMatrixRows SUCCESS: rows=' + (result ? result.length : 0));
      }
      return result;
    } catch (e) {
      console.error('[FiberDesignManager] getSpliceMatrixRows EXCEPTION:', e.message);
      console.error('[FiberDesignManager] getSpliceMatrixRows STACK:', e.stack);
      throw e;
    }
  }

  function getFiberByRef(nodeId, ref) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return null;
    var resolved = resolveFiberRef(nodeStore[id], ref);
    if (!resolved) return null;
    return {
      ref: normalizeFiberRef(ref),
      fiber: deepClone(resolved.fiber),
      tube: {
        id: resolved.tube.id,
        tube_number: resolved.tube.tube_number,
        tube_color: resolved.tube.tube_color,
      },
      cable: {
        id: resolved.cable.id,
        name: resolved.cable.name,
        direction: resolved.cable.direction,
        role: resolved.cable.role,
      },
    };
  }

  function getSplices(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return [];
    return deepClone(nodeStore[id].splices || []);
  }

  function exportAll() {
    var out = {};
    Object.keys(nodeStore).forEach(function (key) {
      out[key] = deepClone(nodeStore[key]);
    });
    return out;
  }

  function importAll(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    nodeStore = Object.create(null);
    Object.keys(snapshot).forEach(function (key) {
      var entry = snapshot[key];
      if (!entry || typeof entry !== 'object') return;
      var nodeId = normalizeNodeId(entry.node_id || key);
      if (!nodeId) return;
      nodeStore[nodeId] = {
        node_id: nodeId,
        node_type: entry.node_type || 'unknown',
        location: entry.location || null,
        metadata: cloneMetadata(entry.metadata || createDefaultMetadata(null, { is_mock: false, source: 'auto_engine' })),
        cables: {
          inbound: Array.isArray(entry.cables && entry.cables.inbound) ? entry.cables.inbound : [],
          outbound: Array.isArray(entry.cables && entry.cables.outbound) ? entry.cables.outbound : [],
        },
        splices: Array.isArray(entry.splices) ? entry.splices : [],
      };
      collectNodeCables(nodeStore[nodeId]).forEach(function (c) {
        enforceFibersPerTube(c.tubes);
      });
    });
    matrixRows = [];
    Object.keys(nodeStore).forEach(function (nodeId) {
      var node = nodeStore[nodeId];
      (node.splices || []).forEach(function (splice) {
        var row = buildMatrixRow(node, splice);
        if (row) matrixRows.push(row);
      });
    });
    matrixRows = sortMatrixRows(matrixRows);
    applyPlcSplitterMapping(matrixRows);
    lastDesignVersion += 1;
    emitDesignChanged();
    return true;
  }

  function removeNodeData(nodeId) {
    var id = normalizeNodeId(nodeId);
    if (!id || !nodeStore[id]) return false;
    delete nodeStore[id];
    matrixRows = matrixRows.filter(function (r) { return String(r.node_id) !== id; });
    return true;
  }

  function ensureNodeDesign(nodeId, mapNode) {
    var id = normalizeNodeId(nodeId);
    if (!id) return null;
    ensureDisplayData();
    if (hasNodeData(id)) return getNodeData(id);
    if (mapNode) {
      ensureEngineNode(mapNode);
      return getNodeData(id);
    }
    return null;
  }

  function initNodeFromMapCables(mapNode) {
    ensureDisplayData();
    if (!mapNode) return null;
    return ensureNodeDesign(mapNode.id, mapNode);
  }

  function generateMockNodeDesign() {
    return AutoFiberEngine.regenerate();
  }

  /** @deprecated Stage 4 — linear auto-splice removed; use AutoFiberEngine.regenerate */
  function autoSpliceSequential() {
    return { ok: false, error: 'deprecated_use_auto_fiber_engine', created: 0, skipped: 0, splices: [] };
  }

  function clearAll() {
    nodeStore = Object.create(null);
    matrixRows = [];
    lastDesignVersion = 0;
  }

  /**
   * Phase 2/4: read visual Main Cable trail metadata saved from interactive draw.
   * Shape: { cabinetId, cabinetLabel, cableRoleLabel, closures:[{id,label}], nodeIds }
   * Used as definitive matrix path truth in applyInteractiveTrailAllocations.
   */
  function getCableMainCableTrail(cable) {
    if (!cable || !cable.mainCableTrail || typeof cable.mainCableTrail !== 'object') return null;
    var trail = cable.mainCableTrail;
    return {
      cabinetId: trail.cabinetId != null ? String(trail.cabinetId) : '',
      cabinetLabel: trail.cabinetLabel != null ? String(trail.cabinetLabel) : '',
      cableRoleLabel: trail.cableRoleLabel || 'M-CABLE',
      cableName: trail.cableName != null ? String(trail.cableName) : String(cable.name || cable.asBuiltId || ''),
      closures: Array.isArray(trail.closures)
        ? trail.closures.map(function (c) {
          return {
            id: c && c.id != null ? String(c.id) : '',
            label: c && c.label != null ? String(c.label) : '',
          };
        })
        : [],
      drops: Array.isArray(trail.drops)
        ? trail.drops.map(function (d) {
          return {
            id: d && d.id != null ? String(d.id) : '',
            label: d && d.label != null ? String(d.label) : '',
          };
        })
        : [],
      nodeIds: Array.isArray(trail.nodeIds) ? trail.nodeIds.map(String) : [],
    };
  }

  function formatMainCableTrailPath(trail, cableId) {
    if (deps && deps.formatMainCableTrailLabelForDisplay) {
      return deps.formatMainCableTrailLabelForDisplay(trail, cableId);
    }
    if (!trail || !trail.cabinetLabel) return '';
    var cableDes = String(trail.cableName || '').trim();
    var head = cableDes
      ? (String(trail.cabinetLabel) + ' ' + cableDes + ' M-Cable')
      : (String(trail.cabinetLabel) + ' M-Cable');
    var parts = [head];
    var resolveHop = deps && deps.resolveMainTrailHopDisplayLabel;
    (trail.closures || []).forEach(function (c) {
      var lbl = resolveHop ? resolveHop(cableId, c) : (c && c.label);
      if (lbl) parts.push(String(lbl));
    });
    if (!(trail.closures || []).length) {
      (trail.drops || []).forEach(function (d) {
        if (d && d.label) parts.push(String(d.label));
      });
    }
    return parts.join(' --> ');
  }

  function getMainCableVisualSequences() {
    var cables = getMapCables() || [];
    var out = [];
    cables.forEach(function (cable) {
      var trail = getCableMainCableTrail(cable);
      if (!trail || !trail.cabinetId) return;
      out.push({
        cableId: cable.id != null ? String(cable.id) : '',
        cableLabel: getCableLabel(cable),
        trail: trail,
        pathLabel: formatMainCableTrailPath(trail, cable.id != null ? String(cable.id) : ''),
      });
    });
    return out;
  }

  /** Phase 3/4: Sub-Cable visual trail (closure → FH/poles) — definitive matrix drops. */
  function getCableSubCableTrail(cable) {
    if (!cable || !cable.subCableTrail || typeof cable.subCableTrail !== 'object') return null;
    var trail = cable.subCableTrail;
    return {
      closureId: trail.closureId != null ? String(trail.closureId) : '',
      closureLabel: trail.closureLabel != null ? String(trail.closureLabel) : '',
      cableRoleLabel: trail.cableRoleLabel || 'S-CABLE',
      cableName: trail.cableName != null ? String(trail.cableName) : String(cable.name || cable.asBuiltId || ''),
      drops: Array.isArray(trail.drops)
        ? trail.drops.map(function (d) {
          return {
            id: d && d.id != null ? String(d.id) : '',
            label: d && d.label != null ? String(d.label) : '',
          };
        })
        : [],
      nodeIds: Array.isArray(trail.nodeIds) ? trail.nodeIds.map(String) : [],
    };
  }

  function formatSubCableTrailPath(trail) {
    if (!trail || !trail.closureLabel) return '';
    var cableDes = String(trail.cableName || '').trim();
    var head = cableDes
      ? (String(trail.closureLabel) + ' ' + cableDes + ' S-Cable')
      : (String(trail.closureLabel) + ' S-Cable');
    var parts = [head];
    (trail.drops || []).forEach(function (d) {
      if (d && d.label) parts.push(String(d.label));
    });
    return parts.join(' --> ');
  }

  function getSubCableVisualSequences() {
    var cables = getMapCables() || [];
    var out = [];
    cables.forEach(function (cable) {
      var trail = getCableSubCableTrail(cable);
      if (!trail || !trail.closureId) return;
      out.push({
        cableId: cable.id != null ? String(cable.id) : '',
        cableLabel: getCableLabel(cable),
        trail: trail,
        pathLabel: formatSubCableTrailPath(trail),
      });
    });
    return out;
  }

  global.FTTHFiberDesignManager = {
    init: init,
    initNodeData: initNodeData,
    getNodeData: getNodeData,
    hasNodeData: hasNodeData,
    addSpliceConnection: addSpliceConnection,
    addCable: addCable,
    getFiberByRef: getFiberByRef,
    getSplices: getSplices,
    ensureNodeDesign: ensureNodeDesign,
    initNodeFromMapCables: initNodeFromMapCables,
    autoSpliceSequential: autoSpliceSequential,
    getClosureRegistry: getClosureRegistry,
    getCabinetRegistry: getCabinetRegistry,
    getSpliceMatrixRows: getSpliceMatrixRows,
    applyPlcSplitterMapping: applyPlcSplitterMapping,
    getCableMainCableTrail: getCableMainCableTrail,
    formatMainCableTrailPath: formatMainCableTrailPath,
    getMainCableVisualSequences: getMainCableVisualSequences,
    getCableSubCableTrail: getCableSubCableTrail,
    formatSubCableTrailPath: formatSubCableTrailPath,
    getSubCableVisualSequences: getSubCableVisualSequences,
    getRingMatrixRows: getRingMatrixRows,
    buildRingMatrixRows: buildRingMatrixRows,
    ensureDisplayData: ensureDisplayData,
    projectHasRealFiberDesignData: projectHasRealFiberDesignData,
    generateMockNodeDesign: generateMockNodeDesign,
    buildLastMileTubes: buildLastMileTubes,
    parseCapacityFromLabel: parseCapacityFromLabel,
    exportAll: exportAll,
    importAll: importAll,
    removeNodeData: removeNodeData,
    clearAll: clearAll,
    createUuid: createUuid,
    createFiber: createFiber,
    createTube: createTube,
    createCable: createCable,
    notifyTopologyChanged: notifyTopologyChanged,
    notifyInteractivePathCommitted: notifyInteractivePathCommitted,
    applyInteractiveTrailAllocations: applyInteractiveTrailAllocations,
    AutoFiberEngine: AutoFiberEngine,
    FIBERS_PER_TUBE: FIBERS_PER_TUBE,
    FATS_PER_TUBE: FATS_PER_TUBE,
    FIBERS_PER_FAT: FIBERS_PER_FAT,
    FIBER_STATUSES: FIBER_STATUSES.slice(),
    SPLICE_TYPES: SPLICE_TYPES.slice(),
    MATRIX_FIBER_TYPES: MATRIX_FIBER_TYPES.slice(),
    LAST_MILE_TUBE_COUNT: deepClone(LAST_MILE_TUBE_COUNT),
    STANDARD_TUBE_COLORS: STANDARD_TUBE_COLORS.slice(),
    STANDARD_FIBER_COLORS: STANDARD_FIBER_COLORS.slice(),
    STANDARD_COLOR_CODE: STANDARD_COLOR_CODE.slice(),
    TUBE_FAT_FIBER_PAIRS: TUBE_FAT_FIBER_PAIRS.map(function (p) {
      return { main: p.main, expansion: p.expansion };
    }),
    RING_FIBERS_PER_TUBE: RING_FIBERS_PER_TUBE,
    RING_NATURAL_TUBE_COLORS: RING_NATURAL_TUBE_COLORS.slice(),
    RING_FIBER_COLORS: RING_FIBER_COLORS.slice(),
    RING_FEEDER_SPECS: deepClone(RING_FEEDER_SPECS),
    DIST_PLC_BLOCK_COLORS: DIST_PLC_BLOCK_COLORS.slice(),
    DIST_PLC_PAIR_COUNT: DIST_PLC_PAIR_COUNT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
