const fs = require('fs');
const path = require('path');
const file = path.join(__dirname, '../js/ftth-lab-pigtail.js');
let src = fs.readFileSync(file, 'utf8');

function delegate(name, args) {
  return (
    'function ' + name + '(' + args + ') {\n' +
    '    return global.FtthLabCable.' + name + '(' +
    args.split(',').map(function (a) { return a.trim(); }).filter(Boolean).join(', ') +
    ');\n  }'
  );
}

function delegateAlias(local, api, args) {
  return (
    'function ' + local + '(' + args + ') {\n' +
    '    return global.FtthLabCable.' + api + '(' +
    args.split(',').map(function (a) { return a.trim(); }).filter(Boolean).join(', ') +
    ');\n  }'
  );
}

function replaceRange(startLine, endLine, replacement) {
  const lines = src.split(/\r?\n/);
  const before = lines.slice(0, startLine - 1);
  const after = lines.slice(endLine);
  src = before.concat(replacement.split(/\r?\n/), after).join('\n');
}

const ranges = [
  [9930, 9993, delegate('flipSelectedCable', 'p')],
  [9924, 9928, delegate('swapCableEndFields', 'p, startKey, endKey')],
  [6956, 7062, [
    '  function placeCable(x, y) {',
    '    return global.FtthLabCable.createCableItem(x, y);',
    '  }',
  ].join('\n')],
  [4531, 4545, [
  '  function purgeStaleFusedBareSegments(machineId) {',
  '    if (!global.FtthLabCable) return;',
  '    global.FtthLabCable.purgeStaleFusedBareSegments(layer, machineId, getFusedAssemblyPigtails);',
  '  }',
  ].join('\n')],
  [4489, 4516, delegate('sliceCableFusedMemberAssemblyParts', 'p, fusedEnd, densePts, total')],
  [3767, 3786, delegate('cableSplicerDockAdapter', 'p, end')],
  [2867, 2934, delegate('buildCableFiberSvg', 'p, opts')],
  [2764, 2865, delegate('buildCableEndStripSvg', 'p, end, densePts, total, sel')],
  [856, 873, delegate('getCableFusedEnd', 'p, asm')],
  [732, 770, delegate('clearCableEndSplicerSnap', 'p, end, opts')],
  [706, 730, delegate('setCableEndSplicerSnap', 'p, end, slot')],
  [85, 88, delegate('cableEndFromToken', 'token')],
  [81, 83, delegate('isCable', 'p')],
];
ranges.sort(function (a, b) { return b[0] - a[0]; });
ranges.forEach(function (r) { replaceRange(r[0], r[1], r[2]); });

// memberSnappedToSplicer
src = src.replace(
  /function memberSnappedToSplicer\(p\) \{[\s\S]*?\n  \}/,
  delegate('memberSnappedToSplicer', 'p')
);

// dockedMemberCableEnd - keep pigtail resolve for live objects
src = src.replace(
  /function dockedMemberCableEnd\(dockRef\) \{[\s\S]*?\n  \}/,
  [
    'function dockedMemberCableEnd(dockRef) {',
    '    if (!dockRef) return \'end\';',
    '    if (dockRef.cableEnd) return global.FtthLabCable.cableEndFromToken(dockRef.cableEnd);',
    '    var p = resolveDockedMember(dockRef);',
    '    if (!p || !isCable(p)) return \'end\';',
    '    return resolveCableEnd(p, p.activeCableEnd);',
    '  }',
  ].join('\n')
);

// refreshSplicerDocks
src = src.replace(
  /function refreshSplicerDocks\(machineId\) \{[\s\S]*?\n  \}\n\n  function renderSplicerFiberOverlays/,
  [
    'function refreshSplicerDocks(machineId) {',
    '    var changed = false;',
    '    var updatedMembers = {};',
    '    var ends = global.FtthLabCable ? global.FtthLabCable.dockedEnds : function (p) { return [\'end\']; };',
    '    pigtails.forEach(function (p) {',
    '      var dockEnds = isCable(p) ? [\'start\', \'end\'] : [\'end\'];',
    '      var ei;',
    '      for (ei = 0; ei < dockEnds.length; ei++) {',
    '        var end = dockEnds[ei];',
    '        if (!cableEndIsSnappedToSplicer(p, end)) continue;',
    '        var mid = end === \'start\' ? p.startSnappedSplicerId : p.snappedSplicerId;',
    '        if (machineId && mid !== machineId) continue;',
    '        var side = end === \'start\' ? p.startSnappedSplicerSide : p.snappedSplicerSide;',
    '        var slot = getSplicerGrooveSlot(mid, side, { forTracking: true });',
    '        if (!slot) {',
    '          clearSplicerSnap(p, { skipRebuild: true, end: end });',
    '          changed = true;',
    '          continue;',
    '        }',
    '        if (syncSnappedPigtailToLiveGroove(p, end)) changed = true;',
    '        if (!updatedMembers[p.id]) {',
    '          updateFiberPath(p);',
    '          updatedMembers[p.id] = true;',
    '        }',
    '      }',
    '    });',
    '    var fusedAssemblyId = machineId ? resolveFusionAssemblyIdForMachine(machineId) : null;',
    '    var hasFusedAssembly = !!(fusedAssemblyId && isFusedAssembly(fusedAssemblyId));',
    '    if (machineId && (changed || hasFusedAssembly)) syncSplicerWeldedTips(machineId);',
    '    if (changed) rebuildLayer();',
    '    if (machineId && hasFusedAssembly) syncFusedAssemblyVisuals(fusedAssemblyId);',
    '    else if (changed) renderSplicerFiberOverlays(machineId);',
    '    else if (machineId) renderSplicerFiberOverlays(machineId);',
    '    else renderSplicerFiberOverlays();',
    '  }',
    '',
    '  function renderSplicerFiberOverlays',
  ].join('\n')
);

// syncSplicerMotorAlignFrame
src = src.replace(
  /function syncSplicerMotorAlignFrame\(machineId\) \{[\s\S]*?\n  \}\n\n  function refreshSplicerDocks/,
  [
    'function syncSplicerMotorAlignFrame(machineId) {',
    '    if (!machineId) return false;',
    '    var any = false;',
    '    var changed = false;',
    '    var updatedMembers = {};',
    '    pigtails.forEach(function (p) {',
    '      var dockEnds = isCable(p) ? [\'start\', \'end\'] : [\'end\'];',
    '      var ei;',
    '      for (ei = 0; ei < dockEnds.length; ei++) {',
    '        var end = dockEnds[ei];',
    '        if (!cableEndIsSnappedToSplicer(p, end)) continue;',
    '        var mid = end === \'start\' ? p.startSnappedSplicerId : p.snappedSplicerId;',
    '        if (mid !== machineId) continue;',
    '        any = true;',
    '        if (syncSnappedPigtailToLiveGroove(p, end)) changed = true;',
    '        if (!updatedMembers[p.id]) {',
    '          updateFiberPath(p);',
    '          updatedMembers[p.id] = true;',
    '        }',
    '      }',
    '    });',
    '    if (any && changed) syncSplicerWeldedTips(machineId);',
    '    if (any) renderSplicerFiberOverlays(machineId);',
    '    return changed;',
    '  }',
    '',
    '  function refreshSplicerDocks',
  ].join('\n')
);

// clearSplicerWeldForMachine
src = src.replace(
  /function clearSplicerWeldForMachine\(machineId\) \{[\s\S]*?\n  \}/,
  [
    'function clearSplicerWeldForMachine(machineId) {',
    '    if (!machineId) return;',
    '    if (global.FtthLabCable) {',
    '      global.FtthLabCable.clearWeldFieldsForMachine(machineId, pigtails, isPigtailFusionPermanent);',
    '    }',
    '    pigtails.forEach(function (p) {',
    '      if (isCable(p)) return;',
    '      if (p.splicerWeldMachineId !== machineId) return;',
    '      if (isPigtailFusionPermanent(p)) return;',
    '      p.splicerWeldMachineId = null;',
    '      p.fusionAssemblyId = null;',
    '      p.fusedPartnerId = null;',
    '      p.fusedJacketEndDist = null;',
    '      p.splicerFusedSide = null;',
    '    });',
    '  }',
  ].join('\n')
);

// clearFusedAssembly member cleanup
src = src.replace(
    '    if (pair.left && !isPigtailFusionPermanent(pair.left)) {\n' +
    '      pair.left.splicerFusedSide = null;\n' +
    '      pair.left.fusedJacketEndDist = null;\n' +
    '      pair.left.isOvenDocked = false;\n' +
    '      pair.left.ovenDockMachineId = null;\n' +
    '      pair.left.isSleeveShrunk = false;\n' +
    '      pair.left.fusionPermanent = false;\n' +
    '      pair.left.fusionAssemblyId = null;\n' +
    '      pair.left.fusedPartnerId = null;\n' +
    '      pair.left.splicerWeldMachineId = null;\n' +
    '    }\n' +
    '    if (pair.right && !isPigtailFusionPermanent(pair.right)) {\n' +
    '      pair.right.splicerFusedSide = null;\n' +
    '      pair.right.fusedJacketEndDist = null;\n' +
    '      pair.right.isOvenDocked = false;\n' +
    '      pair.right.ovenDockMachineId = null;\n' +
    '      pair.right.isSleeveShrunk = false;\n' +
    '      pair.right.fusionPermanent = false;\n' +
    '      pair.right.fusionAssemblyId = null;\n' +
    '      pair.right.fusedPartnerId = null;\n' +
    '      pair.right.splicerWeldMachineId = null;\n' +
    '    }',
  [
    '    if (pair.left && !isPigtailFusionPermanent(pair.left)) {',
    '      if (isCable(pair.left) && global.FtthLabCable) {',
    '        global.FtthLabCable.clearFusionFieldsOnMember(pair.left, isPigtailFusionPermanent);',
    '      }',
    '      pair.left.splicerFusedSide = null;',
    '      pair.left.fusedJacketEndDist = null;',
    '      pair.left.isOvenDocked = false;',
    '      pair.left.ovenDockMachineId = null;',
    '      pair.left.isSleeveShrunk = false;',
    '      pair.left.fusionPermanent = false;',
    '      pair.left.fusionAssemblyId = null;',
    '      pair.left.fusedPartnerId = null;',
    '      pair.left.splicerWeldMachineId = null;',
    '    }',
    '    if (pair.right && !isPigtailFusionPermanent(pair.right)) {',
    '      if (isCable(pair.right) && global.FtthLabCable) {',
    '        global.FtthLabCable.clearFusionFieldsOnMember(pair.right, isPigtailFusionPermanent);',
    '      }',
    '      pair.right.splicerFusedSide = null;',
    '      pair.right.fusedJacketEndDist = null;',
    '      pair.right.isOvenDocked = false;',
    '      pair.right.ovenDockMachineId = null;',
    '      pair.right.isSleeveShrunk = false;',
    '      pair.right.fusionPermanent = false;',
    '      pair.right.fusionAssemblyId = null;',
    '      pair.right.fusedPartnerId = null;',
    '      pair.right.splicerWeldMachineId = null;',
    '    }',
  ].join('\n')
);

// bindHost before closing IIFE
const bindHost = [
  '',
  '  if (global.FtthLabCable && typeof FtthLabCable.bindHost === \'function\') {',
  '    FtthLabCable.bindHost({',
  '      CABLE_FUSION_JACKET_STUB_PX: CABLE_FUSION_JACKET_STUB_PX,',
  '      STRIP_TIP_EPS: STRIP_TIP_EPS,',
  '      STRIP_BUFFER_COMPLETE_PX: STRIP_BUFFER_COMPLETE_PX,',
  '      CLEAVE_TIP_ZONE_PX: CLEAVE_TIP_ZONE_PX,',
  '      CLEAVE_MIN_CUT_PX: CLEAVE_MIN_CUT_PX,',
  '      ORTHO_FILLET_R: ORTHO_FILLET_R,',
  '      SPAWN_LEN_PX: SPAWN_LEN_PX,',
  '      findPigtail: findPigtail,',
  '      ensureFiberStrip: ensureFiberStrip,',
  '      isBareStripComplete: isBareStripComplete,',
  '      getBareGlassLengthAfterCutPx: getBareGlassLengthAfterCutPx,',
  '      isFullyStrippedPigtail: isFullyStrippedPigtail,',
  '      findFusionAssemblyRecordForMember: findFusionAssemblyRecordForMember,',
  '      fiberRenderPathPointsDense: fiberRenderPathPointsDense,',
  '      fiberRenderPathPoints: fiberRenderPathPoints,',
  '      fiberSvgPathFromRenderPoints: fiberSvgPathFromRenderPoints,',
  '      fiberPath: fiberPath,',
  '      slicePolylineByDistance: slicePolylineByDistance,',
  '      polylineLength: polylineLength,',
  '      svgPathFromPoints: svgPathFromPoints,',
  '      usesOrthoRoute: usesOrthoRoute,',
  '      filletOrthoSvg: filletOrthoSvg,',
  '      collapseOrthoPts: collapseOrthoPts,',
  '      getPigtailBufferStrokeColor: getPigtailBufferStrokeColor,',
  '      getSelectionId: function () { return selection.id; },',
  '      ensurePathHistory: ensurePathHistory,',
  '      endRotationDeg: endRotationDeg,',
  '      dist2: dist2,',
  '      projectOntoFiberStrict: projectOntoFiberStrict,',
  '      projectOntoFiberPath: projectOntoFiberPath,',
  '      nextSeq: function () { seq += 1; return seq; },',
  '      defaultPos: defaultPos,',
  '      pushPigtail: function (item) { pigtails.push(item); },',
  '      selectCable: selectCable,',
  '      rebuildLayer: rebuildLayer,',
  '      pushHistory: pushHistory,',
  '      refreshBudget: refreshBudget,',
  '      setStatus: setStatus,',
  '      updateInspector: updateInspector,',
  '    });',
  '  }',
].join('\n');

src = src.replace(
  '})(typeof window !== \'undefined\' ? window : this);',
  bindHost + '\n})(typeof window !== \'undefined\' ? window : this);'
);

fs.writeFileSync(file, src);
console.log('patched pigtail');
