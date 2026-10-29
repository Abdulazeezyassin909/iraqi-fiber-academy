/**
 * FTTH Simulator — read-only label data providers for LabelManager.
 * Extracted from ftth-simulator-core.js (Phase 1).
 */
(function (global) {
  'use strict';

  var deps = null;

  function getSim() {
    return deps?.getSim?.() || null;
  }

  /** Read-only entity label rows (uses existing naming; no logic changes). */
  function getEntityLabelEntries() {
    var Sim = getSim();
    if (!Sim) return [];
    var entries = [];
    (Sim.nodes || []).forEach(function (node) {
      if (!node) return;
      var center = deps.getNodeCenterXY(node);
      if (!center || !isFinite(center.x) || !isFinite(center.y)) return;
      /* Pole-attached FAT handhole: no overlay labels at all (DOM .pole-label only). */
      if (node.type === 'fat_handhole' && node.hasFatPole) return;
      deps.getNodeLabelEntries(node).forEach(function (entry) {
        if (!entry || !entry.text) return;
        /* FAT Pole unified label lives inside .fat-unified-map-marker — skip overlay duplicate */
        if (node.type === 'fat_handhole' && (entry.key === 'unified' || entry.cls === 'fat-system')) return;
        var tier = (entry.cls === 'handhole' || entry.cls === 'fat-handhole') ? 'handhole' : 'equipment';
        entries.push({
          id: node.id + ':' + entry.key,
          nodeId: node.id,
          type: node.type,
          role: entry.cls,
          key: entry.key,
          x: center.x,
          y: center.y,
          label: entry.text,
          tier: tier,
        });
      });
    });
    return entries;
  }

  /** First/last non-null snapped node on the cable (real endpoint ownership). */
  function resolveCableEndpointSnapIds(snaps) {
    var first = null;
    var last = null;
    var i;
    snaps = snaps || [];
    for (i = 0; i < snaps.length; i++) {
      if (snaps[i] == null || snaps[i] === '') continue;
      var id = String(snaps[i]);
      if (!first) first = id;
      last = id;
    }
    return { start: first, end: last };
  }

  function pathEndpointExitAngles(pts) {
    var startAngle = 0;
    var endAngle = 0;
    if (!pts || pts.length < 2) return { start: startAngle, end: endAngle };
    startAngle = Math.atan2(pts[1][1] - pts[0][1], pts[1][0] - pts[0][0]) * (180 / Math.PI);
    var last = pts.length - 1;
    endAngle = Math.atan2(
      pts[last][1] - pts[last - 1][1],
      pts[last][0] - pts[last - 1][0]
    ) * (180 / Math.PI);
    return { start: startAngle, end: endAngle };
  }

  /** Read-only cable label rows — node-anchored (no midpoint placement). */
  function getCableSegmentLabels() {
    var Sim = getSim();
    if (!Sim) return [];
    var results = [];
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      var geom = deps.getCableRenderGeometry(cable);
      var pts = geom?.points || cable.points;
      if (!pts || pts.length < 2) return;
      var label = deps.getCableDisplayBatchLabel(cable);
      if (!label) return;

      var laneInfo = deps.getCableLaneInfo(cable);
      var snapIds = resolveCableEndpointSnapIds(cable.pointSnapNodeIds);
      var endpointNodeIds = [];
      if (snapIds.start) endpointNodeIds.push(snapIds.start);
      if (snapIds.end && snapIds.end !== snapIds.start) endpointNodeIds.push(snapIds.end);
      var exitAngles = pathEndpointExitAngles(pts);

      results.push({
        id: String(cable.id),
        label: label,
        tier: 'cable',
        points: pts.map(function (p) { return [p[0], p[1]]; }),
        endpointStartNodeId: snapIds.start,
        endpointEndNodeId: snapIds.end,
        endpointNodeIds: endpointNodeIds,
        startExitAngle: exitAngles.start,
        endExitAngle: exitAngles.end,
        laneIndex: laneInfo.laneIndex,
        laneTotal: laneInfo.laneTotal,
        laneOffsetPx: laneInfo.offsetPx,
      });
    });
    return results;
  }

  /** Read-only object circles for label collision scoring. */
  function getLabelObjectObstacles() {
    var Sim = getSim();
    if (!Sim) return [];
    return (Sim.nodes || []).map(function (node) {
      if (!node) return null;
      var center = null;
      if (deps.getDeviceSnapCenter) center = deps.getDeviceSnapCenter(node);
      if (!center) center = deps.getNodeCenterXY(node);
      if (!center || !isFinite(center.x) || !isFinite(center.y)) return null;
      var radius = 14;
      if (node.type === 'fdt' || node.type === 'olt') radius = 18;
      else if (node.type === 'fat_handhole' && node.hasFatPole) radius = 16;
      else if (node.type === 'pole_foundation') radius = 15;
      return {
        nodeId: node.id,
        x: center.x,
        y: center.y,
        radius: radius,
        autoName: node.autoName || null,
        type: node.type || null,
      };
    }).filter(Boolean);
  }

  /** Read-only cable segment lines for label collision scoring. */
  function getCablePathSegments() {
    var Sim = getSim();
    if (!Sim) return [];
    var segs = [];
    (Sim.fiberCablePaths || []).forEach(function (cable) {
      if (!cable) return;
      var geom = deps.getCableRenderGeometry(cable);
      var pts = geom?.points || cable.points;
      if (!pts || pts.length < 2) return;
      for (var i = 0; i < pts.length - 1; i++) {
        segs.push({
          x1: pts[i][0], y1: pts[i][1],
          x2: pts[i + 1][0], y2: pts[i + 1][1],
        });
      }
    });
    return segs;
  }

  function findNodeById(nodeId) {
    if (nodeId == null || nodeId === '') return null;
    if (deps.findNode) return deps.findNode(nodeId);
    var Sim = getSim();
    if (!Sim) return null;
    var id = String(nodeId);
    var nodes = Sim.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && String(nodes[i].id) === id) return nodes[i];
    }
    return null;
  }

  /**
   * AB_LM_Cabel list for a node — same source as the evaluation panel.
   * Returns one terminal-label entry per connected cable (1:1, no midpoint).
   */
  function getAbLmCabelLabelEntriesForNode(nodeId) {
    var node = findNodeById(nodeId);
    if (!node || !deps.getCablesLinkedToNode) return [];
    var cables = deps.getCablesLinkedToNode(node) || [];
    if (deps.sortCablesForLaneOrder) {
      cables = deps.sortCablesForLaneOrder(cables);
    }
    var results = [];
    cables.forEach(function (cable, index) {
      if (!cable) return;
      var geom = deps.getCableRenderGeometry(cable);
      var pts = geom?.points || cable.points;
      if (!pts || pts.length < 2) return;
      var label = deps.getCableDisplayBatchLabel(cable);
      if (!label) return;
      var snapIds = resolveCableEndpointSnapIds(cable.pointSnapNodeIds);
      var exitAngles = pathEndpointExitAngles(pts);
      var laneInfo = deps.getCableLaneInfo ? deps.getCableLaneInfo(cable) : {
        laneIndex: index,
        laneTotal: cables.length,
        offsetPx: 0,
      };
      results.push({
        id: String(cable.id),
        label: label,
        tier: 'cable',
        points: pts.map(function (p) { return [p[0], p[1]]; }),
        endpointStartNodeId: snapIds.start,
        endpointEndNodeId: snapIds.end,
        endpointNodeIds: [String(node.id)],
        startExitAngle: exitAngles.start,
        endExitAngle: exitAngles.end,
        laneIndex: index,
        laneTotal: cables.length,
        laneOffsetPx: laneInfo.offsetPx || 0,
        anchorNodeId: String(node.id),
        fromAbLmCabel: true,
      });
    });
    return results;
  }

  function init(api) {
    deps = api || {};
  }

  global.FTTHLabelDataProviders = {
    init: init,
    getEntityLabelEntries: getEntityLabelEntries,
    getCableSegmentLabels: getCableSegmentLabels,
    getAbLmCabelLabelEntriesForNode: getAbLmCabelLabelEntriesForNode,
    getLabelObjectObstacles: getLabelObjectObstacles,
    getCablePathSegments: getCablePathSegments,
  };
})(typeof window !== 'undefined' ? window : globalThis);
