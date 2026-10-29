const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'js/ftth-lab-pigtail.js'), 'utf8').split(/\r?\n/);
const ranges = [
  [81, 88], [90, 104], [316, 588], [597, 612], [630, 770],
  [856, 873], [2734, 2762], [2764, 2934], [3767, 3786], [4489, 4516],
  [6956, 7062], [9924, 9993],
];
let body = '';
for (const [a, b] of ranges) {
  body += lines.slice(a - 1, b).join('\n') + '\n\n';
}
const helpers = `
  function dockedEnds(p) {
    return isCable(p) ? ['start', 'end'] : ['end'];
  }

  function memberSnappedToSplicer(p) {
    if (!p) return false;
    if (!isCable(p)) return !!p.isSnappedToSplicer;
    return !!(p.isSnappedToSplicer || p.startIsSnappedToSplicer);
  }

  function getSplicerExposedBareLengthPxForEnd(p, end) {
    end = resolveCableEnd(p, end);
    if (isCableEndCleaved(p, end)) return H.getBareGlassLengthAfterCutPx();
    return Math.max(H.CLEAVE_MIN_CUT_PX, getBareGlassDrawLengthPxForEnd(p, end));
  }

  function getBareGlassDrawLengthPxForEnd(p, end) {
    if (!p) return 0;
    end = resolveCableEnd(p, end);
    return cableEndRenderDistPx(p, end, 'bare');
  }

  function eachSnappedDockEnd(pigtails, machineId, fn) {
    var updated = {};
    pigtails.forEach(function (p) {
      var ends = dockedEnds(p);
      for (var ei = 0; ei < ends.length; ei++) {
        var end = ends[ei];
        if (!cableEndIsSnappedToSplicer(p, end)) continue;
        var mid = end === 'start' ? p.startSnappedSplicerId : p.snappedSplicerId;
        if (machineId && mid !== machineId) continue;
        fn(p, end, mid);
        updated[p.id] = p;
      }
    });
    return Object.keys(updated).map(function (id) { return updated[id]; });
  }

  function purgeStaleFusedBareSegments(layer, machineId, getPair) {
    if (!layer || !machineId || !getPair) return;
    var pair = getPair(machineId);
    [pair.left, pair.right].forEach(function (pg) {
      if (!pg) return;
      layer.querySelectorAll(
        '[data-pt-fiber-stripped="' + pg.id + '"],' +
        '[data-pt-fiber-stripped="' + pg.id + ':start"],' +
        '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-seg="bare"],' +
        '[data-pt-fiber="' + pg.id + '"][data-pt-fiber-seg="jacket"]'
      ).forEach(function (el) {
        if (el.closest('[data-fused-assembly]')) return;
        if (el.getAttribute('data-pt-fiber-seg') === 'cable-mid-jacket') return;
        if (el.parentNode) el.parentNode.removeChild(el);
      });
    });
  }

  function clearFusionFieldsOnMember(p, isPermanent) {
    if (!p || !isCable(p) || (isPermanent && isPermanent(p))) return;
    p.splicerFusedSide = null;
    p.startSplicerFusedSide = null;
    p.fusedJacketEndDist = null;
    p.startFusedJacketEndDist = null;
    p.fusionAssemblyId = null;
    p.startFusionAssemblyId = null;
    p.fusedPartnerId = null;
    p.startFusedPartnerId = null;
    p.splicerWeldMachineId = null;
    p.startSplicerWeldMachineId = null;
    p.fusionPermanent = false;
    p.startFusionPermanent = false;
  }

  function clearWeldFieldsForMachine(machineId, pigtails, isPermanent) {
    if (!machineId) return;
    pigtails.forEach(function (p) {
      if (!isCable(p)) return;
      if (isPermanent && isPermanent(p)) return;
      if (p.splicerWeldMachineId === machineId || p.startSplicerWeldMachineId === machineId) {
        clearFusionFieldsOnMember(p, isPermanent);
      }
    });
  }

  function dockedMemberCableEnd(dockRef) {
    if (!dockRef) return 'end';
    if (dockRef.cableEnd) return cableEndFromToken(dockRef.cableEnd);
    return 'end';
  }

`;

const header = `(function (global) {
  'use strict';

  var H = null;
  var CABLE_FUSION_JACKET_STUB_PX = 25;

  function bindHost(host) {
    H = host;
    if (host && host.CABLE_FUSION_JACKET_STUB_PX != null) {
      CABLE_FUSION_JACKET_STUB_PX = host.CABLE_FUSION_JACKET_STUB_PX;
    }
  }

`;

const footer = `
${helpers}
  global.FtthLabCable = {
    bindHost: bindHost,
    isCable: isCable,
    cableEndFromToken: cableEndFromToken,
    parseFiberTargetId: parseFiberTargetId,
    fiberTargetId: fiberTargetId,
    syncCablePrepState: syncCablePrepState,
    applyCableLegacyFromPrepStates: applyCableLegacyFromPrepStates,
    ensureCableEndStrip: ensureCableEndStrip,
    getCableEndStripStage: getCableEndStripStage,
    setCableEndStripStage: setCableEndStripStage,
    isCableEndFullyStripped: isCableEndFullyStripped,
    isCableEndCleaved: isCableEndCleaved,
    isCableEndCleaned: isCableEndCleaned,
    cleanedBareClassForEnd: cleanedBareClassForEnd,
    cableStripPathPoints: cableStripPathPoints,
    maxCableEndStripLenPx: maxCableEndStripLenPx,
    cableEndRenderDistPx: cableEndRenderDistPx,
    cableEndTipWorld: cableEndTipWorld,
    cableEndTipDist: cableEndTipDist,
    nearestCableEndAtWorld: nearestCableEndAtWorld,
    cableEndOwnsToolPoint: cableEndOwnsToolPoint,
    cableEndSnappedToSplicer: cableEndSnappedToSplicer,
    cableEndIsSnappedToCleaver: cableEndIsSnappedToCleaver,
    cableEndIsSnappedToSplicer: cableEndIsSnappedToSplicer,
    opticalEndpointKey: opticalEndpointKey,
    resolveCableEnd: resolveCableEnd,
    cableEndPrepState: cableEndPrepState,
    setCableEndSplicerSnap: setCableEndSplicerSnap,
    clearCableEndSplicerSnap: clearCableEndSplicerSnap,
    getCableFusedEnd: getCableFusedEnd,
    buildCableEndResiduePathSvg: buildCableEndResiduePathSvg,
    buildCableEndStripSvg: buildCableEndStripSvg,
    buildCableFiberSvg: buildCableFiberSvg,
    cableSplicerDockAdapter: cableSplicerDockAdapter,
    sliceCableFusedMemberAssemblyParts: sliceCableFusedMemberAssemblyParts,
    createCableItem: placeCable,
    flipSelectedCable: flipSelectedCable,
    swapCableEndFields: swapCableEndFields,
    dockedEnds: dockedEnds,
    eachSnappedDockEnd: eachSnappedDockEnd,
    memberSnappedToSplicer: memberSnappedToSplicer,
    purgeStaleFusedBareSegments: purgeStaleFusedBareSegments,
    clearWeldFieldsForMachine: clearWeldFieldsForMachine,
    clearFusionFieldsOnMember: clearFusionFieldsOnMember,
    dockedMemberCableEnd: dockedMemberCableEnd,
    getSplicerExposedBareLengthPxForEnd: getSplicerExposedBareLengthPxForEnd,
    getBareGlassDrawLengthPxForEnd: getBareGlassDrawLengthPxForEnd
  };
})(typeof window !== 'undefined' ? window : this);
`;

let out = header + body + footer;
// patch references to pigtail-only symbols -> H.*
const subs = [
  ['findPigtail(', 'H.findPigtail('],
  ['ensureFiberStrip(p)', 'H.ensureFiberStrip(p)'],
  ['ensureFiberStrip(p,', 'H.ensureFiberStrip(p,'],
  ['isBareStripComplete(', 'H.isBareStripComplete('],
  ['getBareGlassLengthAfterCutPx()', 'H.getBareGlassLengthAfterCutPx()'],
  ['STRIP_TIP_EPS', 'H.STRIP_TIP_EPS'],
  ['STRIP_BUFFER_COMPLETE_PX', 'H.STRIP_BUFFER_COMPLETE_PX'],
  ['CLEAVE_TIP_ZONE_PX', 'H.CLEAVE_TIP_ZONE_PX'],
  ['CLEAVE_MIN_CUT_PX', 'H.CLEAVE_MIN_CUT_PX'],
  ['ORTHO_FILLET_R', 'H.ORTHO_FILLET_R'],
  ['SPAWN_LEN_PX', 'H.SPAWN_LEN_PX'],
  ['fiberRenderPathPointsDense(', 'H.fiberRenderPathPointsDense('],
  ['fiberRenderPathPoints(', 'H.fiberRenderPathPoints('],
  ['fiberSvgPathFromRenderPoints(', 'H.fiberSvgPathFromRenderPoints('],
  ['fiberPath(', 'H.fiberPath('],
  ['slicePolylineByDistance(', 'H.slicePolylineByDistance('],
  ['polylineLength(', 'H.polylineLength('],
  ['svgPathFromPoints(', 'H.svgPathFromPoints('],
  ['usesOrthoRoute(', 'H.usesOrthoRoute('],
  ['filletOrthoSvg(', 'H.filletOrthoSvg('],
  ['collapseOrthoPts(', 'H.collapseOrthoPts('],
  ['getPigtailBufferStrokeColor(', 'H.getPigtailBufferStrokeColor('],
  ['selection.id', 'H.getSelectionId()'],
  ['ensurePathHistory(', 'H.ensurePathHistory('],
  ['endRotationDeg(', 'H.endRotationDeg('],
  ['dist2(', 'H.dist2('],
  ['projectOntoFiberStrict(', 'H.projectOntoFiberStrict('],
  ['projectOntoFiberPath(', 'H.projectOntoFiberPath('],
  ['isFullyStrippedPigtail(', 'H.isFullyStrippedPigtail('],
  ['findFusionAssemblyRecordForMember(', 'H.findFusionAssemblyRecordForMember('],
  ['pigtails.push(item)', 'H.pushPigtail(item)'],
  ['pigtails.push(item);', 'H.pushPigtail(item);'],
  ['selectCable(item.id)', 'H.selectCable(item.id)'],
  ['rebuildLayer()', 'H.rebuildLayer()'],
  ['pushHistory()', 'H.pushHistory()'],
  ['refreshBudget()', 'H.refreshBudget()'],
  ['setStatus(', 'H.setStatus('],
  ['updateInspector()', 'H.updateInspector()'],
  ['seq += 1', 'H.nextSeq()'],
  ["var item = {\n      id: 'cb-' + seq,", "var item = {\n      id: 'cb-' + H.nextSeq(),"],
  ['defaultPos()', 'H.defaultPos()'],
  ['CABLE_FUSION_JACKET_STUB_PX', 'CABLE_FUSION_JACKET_STUB_PX'],
];
for (const [from, to] of subs) {
  out = out.split(from).join(to);
}
// fix double H.H.
out = out.replace(/H\.H\./g, 'H.');
fs.writeFileSync(path.join(root, 'js/ftth-lab-cable-core.js'), out);
console.log('wrote ftth-lab-cable-core.js', out.split('\n').length, 'lines');
