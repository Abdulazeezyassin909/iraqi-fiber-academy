/**
 * pathwayEditor.js — Geometry, hit tests, split, curves, vertex editing.
 */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var PATH_HIT_TOLERANCE = 12;
  var PATH_HIT_TOLERANCE_SQ = 144;
  var VERTEX_HIT_RADIUS = 10;
  var VERTEX_HIT_RADIUS_SQ = 100;
  var MIDPOINT_HIT_RADIUS = 8;
  var MIDPOINT_HIT_RADIUS_SQ = 64;
  var SEGMENT_INSERT_TOLERANCE = 12;
  var SEGMENT_INSERT_TOLERANCE_SQ = 144;
  var SPLIT_VERTEX_SNAP = 5;
  var CONNECT_SNAP_RADIUS = 10;
  var RECONNECT_SNAP_RADIUS = 14;
  var RECONNECT_SNAP_RADIUS_SQ = RECONNECT_SNAP_RADIUS * RECONNECT_SNAP_RADIUS;
  var CUT_HOVER_TOLERANCE = 12;

  var bridge = null;

  function b() { return bridge; }
  function sim() { return b()?.getSim?.(); }

  function svgCoords(e) {
    if (b()?.getSVGCoordinates) return b().getSVGCoordinates(e);
    return b()?.pointerEventToCanvasXY?.(e) || { x: 0, y: 0 };
  }

  function distToSegmentSq(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1;
    var dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    var projX;
    var projY;
    var t;
    if (lenSq === 0) {
      projX = x1;
      projY = y1;
      t = 0;
    } else {
      t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
      projX = x1 + t * dx;
      projY = y1 + t * dy;
    }
    var ddx = px - projX;
    var ddy = py - projY;
    return { distSq: ddx * ddx + ddy * ddy, t: t, x: projX, y: projY };
  }

  function distToSegment(px, py, x1, y1, x2, y2) {
    var hit = distToSegmentSq(px, py, x1, y1, x2, y2);
    hit.dist = Math.sqrt(hit.distSq);
    return hit;
  }

  function iterateAllPaths(fn) {
    var S = sim();
    if (!S || typeof fn !== 'function') return;
    (S.excavationPaths || []).forEach(function (p) { fn('excavation', p); });
    (S.fiberCablePaths || []).forEach(function (p) { fn('fiber', p); });
  }

  function findPathByRef(ref) {
    return b()?.findPathByRef?.(ref) || null;
  }

  function getEffectivePathPoints(type, path) {
    if (type === 'fiber' && b()?.getCableRenderGeometry) {
      var geom = b().getCableRenderGeometry(path);
      return geom?.points || path?.points;
    }
    return path?.points;
  }

  function hitTestPathsAll(x, y, tol) {
    var tolSq = (tol || PATH_HIT_TOLERANCE) * (tol || PATH_HIT_TOLERANCE);
    var hits = [];

    function pushHit(type, path, pts, pathId) {
      if (!pts || pts.length < 2 || !path) return;
      for (var i = 0; i < pts.length - 1; i++) {
        var p1 = pts[i];
        var p2 = pts[i + 1];
        if (!p1 || !p2) continue;
        var hit = distToSegmentSq(x, y, p1[0], p1[1], p2[0], p2[1]);
        if (hit.distSq <= tolSq) {
          hits.push({
            type: type,
            id: pathId || path.id,
            path: path,
            segIndex: i,
            dist: Math.sqrt(hit.distSq),
            x: hit.x,
            y: hit.y,
          });
        }
      }
    }

    var S = sim();
    if (!S) return hits;

    (S.excavationPaths || []).forEach(function (p) {
      pushHit('excavation', p, getEffectivePathPoints('excavation', p), p.id);
      (p.connectorSegments || []).forEach(function (connSeg) {
        var connPts = buildConnectorRenderPoints(p, connSeg) || [];
        if (connPts.length >= 2) {
          pushHit('excavation', p, connPts, p.id);
        }
      });
    });

    (S.fiberCablePaths || []).forEach(function (p) {
      var geom = b()?.getCableRenderGeometry?.(p);
      pushHit('fiber', p, geom?.points || p.points, p.id);
    });

    hits.sort(function (a, b) {
      if (a.dist !== b.dist) return a.dist - b.dist;
      if (a.type !== b.type) return a.type === 'fiber' ? -1 : 1;
      return String(a.id).localeCompare(String(b.id));
    });

    var deduped = [];
    var seen = {};
    hits.forEach(function (h) {
      var key = h.type + ':' + h.id;
      if (seen[key]) return;
      seen[key] = 1;
      deduped.push(h);
    });
    return deduped;
  }

  function pickPathHitAtPoint(x, y, tol) {
    var hits = hitTestPathsAll(x, y, tol);
    if (!hits.length) return null;
    var bestDist = hits[0].dist;
    var nearHits = hits.filter(function (h) { return h.dist <= bestDist + 2; });
    var S = sim();
    if (!S) return nearHits[0];
    if (!S.ui) S.ui = {};
    var key = Math.round(x * 2) + ':' + Math.round(y * 2);
    if (S.ui.pathPickCycle && S.ui.pathPickCycle.key === key) {
      S.ui.pathPickCycle.index = (S.ui.pathPickCycle.index + 1) % nearHits.length;
    } else {
      S.ui.pathPickCycle = { key: key, index: 0 };
    }
    return nearHits[S.ui.pathPickCycle.index];
  }

  function hitTestPaths(x, y, tol) {
    var hits = hitTestPathsAll(x, y, tol);
    return hits.length ? hits[0] : null;
  }

  function hitTestVertexOnPath(pathType, pathId, x, y, radius) {
    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts) return null;
    var radiusSq = (radius || VERTEX_HIT_RADIUS) * (radius || VERTEX_HIT_RADIUS);
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (!pt) continue;
      var dx = pt[0] - x;
      var dy = pt[1] - y;
      if (dx * dx + dy * dy <= radiusSq) {
        return { pathType: pathType, pathId: pathId, index: i, x: pt[0], y: pt[1] };
      }
    }
    return null;
  }

  function hitTestVertexOnAnyPath(x, y, radius) {
    var radiusSq = (radius || VERTEX_HIT_RADIUS) * (radius || VERTEX_HIT_RADIUS);
    var best = null;
    var bestDistSq = Infinity;
    iterateAllPaths(function (type, path) {
      var pts = path?.points;
      if (!pts) return;
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        if (!pt) continue;
        var dx = pt[0] - x;
        var dy = pt[1] - y;
        var distSq = dx * dx + dy * dy;
        if (distSq <= radiusSq && distSq < bestDistSq) {
          bestDistSq = distSq;
          best = { pathType: type, pathId: path.id, index: i, x: pt[0], y: pt[1] };
        }
      }
    });
    return best;
  }

  function hitTestVertexOnSelected(x, y) {
    var S = sim();
    if (!S?.selectedPath) return null;
    return hitTestVertexOnPath(S.selectedPath.type, S.selectedPath.id, x, y, VERTEX_HIT_RADIUS);
  }

  function hitTestSegmentInsertOnSelected(x, y, tolerance) {
    var S = sim();
    if (!S?.selectedPath) return null;
    var path = findPathByRef(S.selectedPath);
    var pts = path?.points;
    if (!pts || pts.length < 2) return null;
    var tolSq = (tolerance || SEGMENT_INSERT_TOLERANCE) * (tolerance || SEGMENT_INSERT_TOLERANCE);
    var best = null;
    var bestDistSq = Infinity;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      var hit = distToSegmentSq(x, y, p1[0], p1[1], p2[0], p2[1]);
      if (hit.distSq > tolSq) continue;
      if (hitTestVertexOnPath(S.selectedPath.type, S.selectedPath.id, hit.x, hit.y, VERTEX_HIT_RADIUS)) continue;
      if (hit.distSq < bestDistSq) {
        bestDistSq = hit.distSq;
        best = {
          pathType: S.selectedPath.type,
          pathId: S.selectedPath.id,
          segIndex: i,
          x: hit.x,
          y: hit.y,
          dist: Math.sqrt(hit.distSq),
        };
      }
    }
    return best;
  }

  function pickVertexDragTarget(x, y, clientX, clientY) {
    var S = sim();
    if (!S?.selectedPath || !isVertexToolActive()) return null;
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      var screenHit = global.FTTHDrawingEngine?.hitTestVertexScreenPx?.(
        clientX, clientY, S.selectedPath.type, S.selectedPath.id
      );
      if (screenHit) {
        return {
          kind: 'vertex',
          pathType: screenHit.pathType,
          pathId: screenHit.pathId,
          index: screenHit.index,
        };
      }
    }
    var ref = S.selectedPath;
    var vHit = hitTestVertexOnPath(ref.type, ref.id, x, y, VERTEX_HIT_RADIUS);
    if (vHit) {
      return {
        kind: 'vertex',
        pathType: vHit.pathType,
        pathId: vHit.pathId,
        index: vHit.index,
      };
    }
    return null;
  }

  function insertVertexOnSegment(pathType, pathId, segIndex, x, y) {
    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts?.[segIndex + 1]) return -1;
    var pt = [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
    pts.splice(segIndex + 1, 0, pt);
    var insertIndex = segIndex + 1;
    b()?.propagateLockedVertexInsert?.(pathType, pathId, insertIndex, pt);
    if (pathType === 'excavation') b()?.syncCablesOnTrench?.(pathId);
    else if (pathType === 'fiber') b()?.syncLockedPathFromCable?.(pathId);
    return insertIndex;
  }

  function scheduleVertexDragRender() {
    global.FTTHDrawingEngine?.requestGhostRedraw?.();
  }

  function diamondPoints(x, y, size) {
    return x + ',' + (y - size) + ' ' +
      (x + size) + ',' + y + ' ' +
      x + ',' + (y + size) + ' ' +
      (x - size) + ',' + y;
  }

  function updateVertexHandlesInPlace(svg, pathObj, pathType, activeIndex) {
    var g = svg?.querySelector?.('.vertex-handles');
    var pts = pathObj?.points;
    if (!g || !pts?.length) return false;
    var diamonds = g.querySelectorAll('.vertex-handle');
    if (diamonds.length !== pts.length) return false;
    var size = 4;
    for (var i = 0; i < pts.length; i++) {
      var pt = pts[i];
      if (!pt) continue;
      diamonds[i].setAttribute('points', diamondPoints(pt[0], pt[1], size));
    }
    return true;
  }

  function attachVertexDragListeners() {
    /* owned by FTTHDrawingEngine.beginGhostVertexDrag */
  }

  function detachVertexDragListeners() {
    /* owned by FTTHDrawingEngine.commit/cancelGhostVertexDrag */
  }

  function onVertexDragMove(e) {
    global.FTTHDrawingEngine?.updateGhostPositionFromEvent?.(e);
  }

  function cancelVertexDrag() {
    global.FTTHDrawingEngine?.cancelGhostVertexDrag?.();
  }

  function commitVertexDrag() {
    var result = global.FTTHDrawingEngine?.commitGhostVertexDrag?.();
    return !!(result && (result.changed || result.merged));
  }

  function addVertexAtDblClick(x, y) {
    var S = sim();
    if (!S?.selectedPath || !isVertexToolActive()) return false;
    var hit = hitTestSegmentInsertOnSelected(x, y, SEGMENT_INSERT_TOLERANCE);
    if (!hit) return false;
    var idx = insertVertexOnSegment(hit.pathType, hit.pathId, hit.segIndex, hit.x, hit.y);
    if (idx < 0) return false;
    if (!S.pathEdit) S.pathEdit = { drag: null, context: null };
    S.pathEdit.selectedVertexIndex = idx;
    S.pathEdit.insertHover = null;
    S.pathEdit.ghostPosition = null;
    b()?.saveState?.();
    b()?.updateMetrics?.();
    b()?.requestCanvasRedraw?.();
    requestAnimationFrame(function () {
      b()?.syncVertexControlBar?.();
      global.PathwayPropertiesModal?.refresh?.();
    });
    b()?.updateStatus?.('Vertex added — double-click on path');
    return true;
  }

  function onVertexDragUp(e) {
    finishVertexGhostDrag(e);
  }

  function finishVertexGhostDrag(e) {
    global.FTTHDrawingEngine?.releaseGhostPointer?.();
  }

  function hitTestMidpointOnSelected(x, y) {
    var S = sim();
    if (!S?.selectedPath) return null;
    var path = findPathByRef(S.selectedPath);
    var pts = path?.points;
    if (!pts || pts.length < 2) return null;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      var mx = (p1[0] + p2[0]) / 2;
      var my = (p1[1] + p2[1]) / 2;
      var dx = mx - x;
      var dy = my - y;
      if (dx * dx + dy * dy <= MIDPOINT_HIT_RADIUS_SQ) {
        return { pathType: S.selectedPath.type, pathId: S.selectedPath.id, segIndex: i, x: mx, y: my };
      }
    }
    return null;
  }

  function normalizeDrawPoint(pt, cs) {
    if (Array.isArray(pt) && pt.length >= 2) return [pt[0], pt[1]];
    if (pt && typeof pt.col === 'number' && typeof pt.row === 'number') {
      return [pt.col * cs + cs / 2, pt.row * cs + cs / 2];
    }
    return [0, 0];
  }

  function computeFillet(a, b, c, radius) {
    if (!a || !b || !c || radius <= 0) return null;
    var v1x = a[0] - b[0];
    var v1y = a[1] - b[1];
    var v2x = c[0] - b[0];
    var v2y = c[1] - b[1];
    var len1 = Math.hypot(v1x, v1y);
    var len2 = Math.hypot(v2x, v2y);
    if (len1 < 0.001 || len2 < 0.001) return null;
    var r = Math.min(radius, len1 * 0.45, len2 * 0.45);
    var u1x = v1x / len1;
    var u1y = v1y / len1;
    var u2x = v2x / len2;
    var u2y = v2y / len2;
    return {
      start: [b[0] + u1x * r, b[1] + u1y * r],
      end: [b[0] + u2x * r, b[1] + u2y * r],
      control: [b[0], b[1]],
    };
  }

  function pointsToCurvedD(points, cornerRadii) {
    if (!points || points.length < 2) return '';
    var radii = cornerRadii || {};
    var d = 'M' + points[0][0] + ' ' + points[0][1];
    var i = 1;
    while (i < points.length) {
      var prev = points[i - 1];
      var curr = points[i];
      var next = points[i + 1];
      var r = Math.min(50, Math.max(0, radii[i] || radii[String(i)] || 0));
      if (r > 0 && next) {
        var fillet = computeFillet(prev, curr, next, r);
        if (fillet) {
          d += ' L' + fillet.start[0].toFixed(2) + ' ' + fillet.start[1].toFixed(2);
          d += ' Q' + fillet.control[0].toFixed(2) + ' ' + fillet.control[1].toFixed(2) +
            ' ' + fillet.end[0].toFixed(2) + ' ' + fillet.end[1].toFixed(2);
          i++;
          continue;
        }
      }
      d += ' L' + curr[0] + ' ' + curr[1];
      i++;
    }
    return d.trim();
  }

  function pointsToD(points, cs, cornerRadii) {
    if (!points || points.length < 2) return '';
    var norm = points.map(function (p) { return normalizeDrawPoint(p, cs); });
    var hasRadius = cornerRadii && Object.keys(cornerRadii).some(function (k) { return (cornerRadii[k] || 0) > 0; });
    if (hasRadius) return pointsToCurvedD(norm, cornerRadii);
    var d = '';
    for (var i = 0; i < norm.length; i++) {
      d += (i === 0 ? 'M' : 'L') + norm[i][0] + ' ' + norm[i][1] + ' ';
    }
    return d.trim();
  }

  function measurePathD(d) {
    if (!d) return 0;
    var svg = b()?.ensureGlobalDrawingLayer?.();
    if (!svg) return 0;
    try {
      var tmp = document.createElementNS(SVG_NS, 'path');
      tmp.setAttribute('d', d);
      tmp.setAttribute('visibility', 'hidden');
      svg.appendChild(tmp);
      var len = tmp.getTotalLength();
      svg.removeChild(tmp);
      return len;
    } catch (err) {
      return 0;
    }
  }

  function getPathLength(pathObj, cs) {
    if (!pathObj?.points?.length) return 0;
    var d = pointsToD(pathObj.points, cs, pathObj.cornerRadii);
    return measurePathD(d);
  }

  function insertVertexAtMidpoint(pathType, pathId, segIndex) {
    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts?.[segIndex + 1]) return -1;
    var p1 = pts[segIndex];
    var p2 = pts[segIndex + 1];
    var mx = [Math.round(((p1[0] + p2[0]) / 2) * 10) / 10, Math.round(((p1[1] + p2[1]) / 2) * 10) / 10];
    pts.splice(segIndex + 1, 0, mx);
    var insertIndex = segIndex + 1;
    b()?.propagateLockedVertexInsert?.(pathType, pathId, insertIndex, mx);
    if (pathType === 'excavation') b()?.syncCablesOnTrench?.(pathId);
    else if (pathType === 'fiber') b()?.syncLockedPathFromCable?.(pathId);
    return insertIndex;
  }

  function clonePathPoints(points) {
    if (!points) return [];
    return points.map(function (p) { return p ? [p[0], p[1]] : [0, 0]; });
  }

  function projectPointOnPolyline(points, x, y) {
    if (!points || points.length < 2) return null;
    var best = null;
    var bestDist = Infinity;
    for (var i = 0; i < points.length - 1; i++) {
      var ax = points[i][0];
      var ay = points[i][1];
      var bx = points[i + 1][0];
      var by = points[i + 1][1];
      var dx = bx - ax;
      var dy = by - ay;
      var lenSq = dx * dx + dy * dy;
      var t = lenSq < 1e-6 ? 0 : Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lenSq));
      var px = ax + t * dx;
      var py = ay + t * dy;
      var dist = Math.hypot(x - px, y - py);
      if (dist < bestDist) {
        bestDist = dist;
        best = { segIndex: i, x: px, y: py, dist: dist };
      }
    }
    return best;
  }

  function resolveGroupEditTarget(pathType, pathId, x, y) {
    if (pathType === 'fiber') {
      var cable = findPathByRef({ type: 'fiber', id: pathId });
      if (b()?.isCableTrenchVertexLocked?.(cable)) {
        var trench = b()?.resolveTrenchForCable?.(cable);
        if (trench?.points?.length >= 2) {
          if (x != null && y != null && isFinite(x) && isFinite(y)) {
            var proj = projectPointOnPolyline(trench.points, x, y);
            if (proj) {
              return {
                pathType: 'excavation',
                pathId: trench.id,
                segIndex: proj.segIndex,
                x: proj.x,
                y: proj.y,
              };
            }
          }
          return { pathType: 'excavation', pathId: trench.id, segIndex: null, x: x, y: y };
        }
      }
    }
    return { pathType: pathType, pathId: pathId, segIndex: null, x: x, y: y };
  }

  function splitLockedCablesForTrench(trenchId, pts1, pts2, newTrenchId, origEndFree) {
    var S = sim();
    if (!S || !trenchId || !newTrenchId) return;
    var cables = b()?.getCablesOnTrench?.(trenchId) || [];
    cables.forEach(function (cable) {
      if (!cable || !b()?.isCableTrenchVertexLocked?.(cable)) return;
      if (!cable.points || cable.points.length < 2) return;
      cable.points = clonePathPoints(pts1);
      cable.freeEnds = cable.freeEnds || {};
      cable.freeEnds.end = true;
      if (cable.connectedTo) cable.connectedTo.end = null;

      S.fiberCablePathId = (S.fiberCablePathId || 0) + 1;
      var newCable = {
        id: 'cable_path_' + S.fiberCablePathId,
        type: 'Fiber_Cable',
        kind: cable.kind,
        capacity: cable.capacity,
        batch: cable.batch,
        name: cable.name,
        trenchPathId: newTrenchId,
        hostTrenchId: newTrenchId,
        trenchPathIds: [newTrenchId],
        points: clonePathPoints(pts2),
        cornerRadii: JSON.parse(JSON.stringify(cable.cornerRadii || {})),
        connectedTo: { start: null, end: cable.connectedTo?.end || null },
        freeEnds: { start: true, end: origEndFree },
        mergedToTrench: newTrenchId,
      };
      S.fiberCablePaths.push(newCable);
      b()?.registerCableOnTrench?.(newTrenchId, newCable.id);
    });
    b()?.syncCablesOnTrench?.(trenchId);
    b()?.syncCablesOnTrench?.(newTrenchId);
  }

  function splitAtVertex(pathType, pathId, vertexIndex) {
    var group = resolveGroupEditTarget(pathType, pathId, null, null);
    pathType = group.pathType;
    pathId = group.pathId;

    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts || pts.length < 2) return false;
    if (vertexIndex <= 0 || vertexIndex >= pts.length - 1) {
      b()?.updateStatus?.('Cannot split at endpoint', true);
      return false;
    }
    var pts1 = pts.slice(0, vertexIndex + 1);
    var pts2 = pts.slice(vertexIndex);
    return createSplitPaths(pathType, path, pts1, pts2);
  }

  function isPathEndFree(path, vertexIndex) {
    if (!path) return false;
    if (path.freeEnds) return vertexIndex === 0 ? !!path.freeEnds.start : !!path.freeEnds.end;
    var ct = path.connectedTo || {};
    return vertexIndex === 0 ? !ct.start : !ct.end;
  }

  function createSplitPaths(pathType, path, pts1, pts2) {
    if (!pts1 || !pts2 || pts1.length < 2 || pts2.length < 2) {
      b()?.updateStatus?.('Need longer path to split', true);
      return false;
    }
    var S = sim();
    if (!S || !path) return false;

    if (pathType === 'fiber' && b()?.isCableTrenchVertexLocked?.(path)) {
      var hostTrench = b()?.resolveTrenchForCable?.(path);
      if (hostTrench) {
        pathType = 'excavation';
        path = hostTrench;
      }
    }

    var origStartFree = isPathEndFree(path, 0);
    var origEndFree = isPathEndFree(path, path.points.length - 1);

    path.points = pts1;
    var newPath;
    if (pathType === 'excavation') {
      S.excavationPathId++;
      newPath = {
        id: 'excavation_' + S.excavationPathId,
        type: path.type || 'LM_Excavation',
        kind: path.kind,
        points: pts2,
        cornerRadii: JSON.parse(JSON.stringify(path.cornerRadii || {})),
        connectedTo: { start: null, end: path.connectedTo?.end || null },
        freeEnds: { start: true, end: origEndFree },
        cableIds: [],
      };
      S.excavationPaths.push(newPath);
      splitLockedCablesForTrench(path.id, pts1, pts2, newPath.id, origEndFree);
      b()?.syncCablesOnTrench?.(path.id);
      b()?.syncCablesOnTrench?.(newPath.id);
    } else {
      S.fiberCablePathId++;
      newPath = {
        id: 'cable_path_' + S.fiberCablePathId,
        type: 'Fiber_Cable',
        kind: path.kind,
        capacity: path.capacity,
        batch: path.batch,
        name: path.name,
        trenchPathId: path.trenchPathId || path.hostTrenchId || null,
        hostTrenchId: path.trenchPathId || path.hostTrenchId || null,
        points: pts2,
        cornerRadii: JSON.parse(JSON.stringify(path.cornerRadii || {})),
        connectedTo: { start: null, end: path.connectedTo?.end || null },
        freeEnds: { start: true, end: origEndFree },
      };
      S.fiberCablePaths.push(newPath);
    }
    if (path.connectedTo) path.connectedTo.end = null;
    path.freeEnds = { start: origStartFree, end: true };
    b()?.selectPath?.(pathType, path.id);
    b()?.notifyNetworkTopologyChanged?.();
    b()?.resetMapPointerState?.();
    b()?.requestCanvasRedraw?.();
    b()?.updateStatus?.('Path split — open ends marked in Cut mode');
    return true;
  }

  function splitPathAt(pathType, pathId, segIndex, splitXY) {
    var group = resolveGroupEditTarget(pathType, pathId, splitXY[0], splitXY[1]);
    pathType = group.pathType;
    pathId = group.pathId;
    if (group.segIndex != null) segIndex = group.segIndex;
    splitXY = [group.x, group.y];

    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts || pts.length < 2) return false;
    for (var vi = 0; vi < pts.length; vi++) {
      var pt = pts[vi];
      if (pt && Math.hypot(pt[0] - splitXY[0], pt[1] - splitXY[1]) <= SPLIT_VERTEX_SNAP) {
        return splitAtVertex(pathType, pathId, vi);
      }
    }
    var pt = [Math.round(splitXY[0] * 10) / 10, Math.round(splitXY[1] * 10) / 10];
    var pts1 = pts.slice(0, segIndex + 1).concat([pt]);
    var pts2 = [pt].concat(pts.slice(segIndex + 1));
    return createSplitPaths(pathType, path, pts1, pts2);
  }

  function segmentIntersection(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
    var dxa = ax2 - ax1;
    var dya = ay2 - ay1;
    var dxb = bx2 - bx1;
    var dyb = by2 - by1;
    var denom = dxa * dyb - dya * dxb;
    if (Math.abs(denom) < 1e-6) return null;
    var t = ((bx1 - ax1) * dyb - (by1 - ay1) * dxb) / denom;
    var u = ((bx1 - ax1) * dya - (by1 - ay1) * dxa) / denom;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: ax1 + t * dxa, y: ay1 + t * dya, t: t };
  }

  function swipeIntersection(x0, y0, x1, y1) {
    var best = null;
    iterateAllPaths(function (type, path) {
      var pts = path?.points;
      if (!pts || pts.length < 2) return;
      for (var i = 0; i < pts.length - 1; i++) {
        var p1 = pts[i];
        var p2 = pts[i + 1];
        if (!p1 || !p2) continue;
        var hit = segmentIntersection(x0, y0, x1, y1, p1[0], p1[1], p2[0], p2[1]);
        if (!hit) continue;
        if (!best || hit.t < best.t) {
          best = {
            type: type, id: path.id, segIndex: i,
            x: hit.x, y: hit.y, t: hit.t,
          };
        }
      }
    });
    return best;
  }

  function collectExcavationReconnectVertices(path) {
    var out = [];
    if (!path?.points?.length) return out;
    var pts = path.points;
    var ends = [0, pts.length - 1];
    for (var ei = 0; ei < ends.length; ei++) {
      var vi = ends[ei];
      var pt = pts[vi];
      if (!pt) continue;
      out.push({
        pathType: 'excavation',
        pathId: path.id,
        vertexIndex: vi,
        pt: [pt[0], pt[1]],
        end: vi === 0 ? 'start' : 'end',
        kind: 'path-endpoint',
      });
    }
    (path.connectorSegments || []).forEach(function (seg, connIdx) {
      var connPts = buildConnectorRenderPoints(path, seg) || [];
      if (connPts.length < 2) return;
      var tail = connPts[connPts.length - 1];
      if (!tail) return;
      out.push({
        pathType: 'excavation',
        pathId: path.id,
        vertexIndex: seg.fromVertexIndex,
        connectorIndex: connIdx,
        isConnectorEnd: true,
        pt: [tail[0], tail[1]],
        end: null,
        kind: 'path-endpoint',
      });
    });
    return out;
  }

  function findFreeExcavationEndpointNear(x, y, clientX, clientY, opts) {
    opts = opts || {};
    var radius = opts.radius || RECONNECT_SNAP_RADIUS;
    var radiusSq = radius * radius;
    var wantType = opts.pathType || 'excavation';
    var best = null;
    var bestMetric = radiusSq + 1;
    var useScreen = clientX != null && clientY != null;
    var freeOnly = opts.freeOnly !== false;

    iterateAllPaths(function (type, path) {
      if (wantType && type !== wantType) return;
      if (!path?.id) return;
      collectExcavationReconnectVertices(path).forEach(function (vtx) {
        if (freeOnly && vtx.vertexIndex != null && !vtx.isConnectorEnd) {
          if (!isPathEndFree(path, vtx.vertexIndex)) return;
        }
        var pt = vtx.pt;
        if (!pt) return;
        var metric;
        if (useScreen) {
          metric = global.FTTHDrawingEngine?.screenDistSqToCanvasPoint?.(clientX, clientY, pt[0], pt[1]);
          if (metric == null || metric > radiusSq) return;
        } else {
          var dist = Math.hypot(pt[0] - x, pt[1] - y);
          if (dist > radius) return;
          metric = dist * dist;
        }
        if (metric < bestMetric) {
          bestMetric = metric;
          best = {
            type: type,
            id: path.id,
            pt: [pt[0], pt[1]],
            vertexIndex: vtx.vertexIndex,
            end: vtx.end || null,
            path: path,
            kind: vtx.kind || 'path-endpoint',
            connectorIndex: vtx.connectorIndex,
            isConnectorEnd: !!vtx.isConnectorEnd,
          };
        }
      });
    });
    return best;
  }

  function inferReconnectTargetAnyExcavation(lastPt, fromRef) {
    if (!lastPt || !fromRef) return null;
    var S = sim();
    if (!S) return null;
    var tol = RECONNECT_SNAP_RADIUS;
    var best = null;
    var bestDist = tol + 1;

    (S.excavationPaths || []).forEach(function (path) {
      if (!path?.id) return;
      collectExcavationReconnectVertices(path).forEach(function (vtx) {
        if (path.id === fromRef.id && vtx.vertexIndex === fromRef.vertexIndex && !vtx.isConnectorEnd) return;
        var pt = vtx.pt;
        if (!pt) return;
        var d = Math.hypot(pt[0] - lastPt[0], pt[1] - lastPt[1]);
        if (d > tol) return;
        var rank = d - (path.id !== fromRef.id ? 0.35 : 0);
        if (rank < bestDist) {
          bestDist = rank;
          best = {
            type: 'excavation',
            id: path.id,
            vertexIndex: vtx.vertexIndex,
          };
        }
      });
    });
    return best;
  }

  function findNearestPathVertex(x, y, clientX, clientY, opts) {
    opts = opts || {};
    var radius = opts.radius || VERTEX_HIT_RADIUS;
    var radiusSq = radius * radius;
    var wantType = opts.pathType || null;
    var best = null;
    var bestMetric = radiusSq + 1;
    var useScreen = clientX != null && clientY != null;
    iterateAllPaths(function (type, path) {
      if (wantType && type !== wantType) return;
      if (opts.excludePath && type === opts.excludePath.type && path.id === opts.excludePath.id) return;
      var pts = path?.points;
      if (!pts?.length) return;
      for (var i = 0; i < pts.length; i++) {
        var pt = pts[i];
        if (!pt) continue;
        var metric;
        if (useScreen) {
          metric = global.FTTHDrawingEngine?.screenDistSqToCanvasPoint?.(clientX, clientY, pt[0], pt[1]);
          if (metric == null || metric > radiusSq) continue;
        } else {
          var dist = Math.hypot(pt[0] - x, pt[1] - y);
          if (dist > radius) continue;
          metric = dist * dist;
        }
        if (metric < bestMetric) {
          bestMetric = metric;
          best = {
            type: type,
            id: path.id,
            pt: [pt[0], pt[1]],
            vertexIndex: i,
            end: i === 0 ? 'start' : (i === pts.length - 1 ? 'end' : null),
            path: path,
            kind: (i === 0 || i === pts.length - 1) ? 'path-endpoint' : 'path-vertex',
          };
        }
      }
    });
    return best;
  }

  function findConnectSnapTarget(x, y) {
    var best = null;
    var bestDist = CONNECT_SNAP_RADIUS + 1;
    var S = sim();

    (S?.nodes || []).forEach(function (node) {
      var c = b()?.getNodeCenterXY?.(node);
      if (!c) return;
      var d = Math.hypot(c.x - x, c.y - y);
      if (d <= CONNECT_SNAP_RADIUS && d < bestDist) {
        bestDist = d;
        best = { kind: 'node', nodeId: node.id, x: c.x, y: c.y, dist: d };
      }
    });

    iterateAllPaths(function (type, path) {
      if (!path?.points?.length) return;
      for (var i = 0; i < path.points.length; i++) {
        var pt = path.points[i];
        if (!pt) continue;
        var d = Math.hypot(pt[0] - x, pt[1] - y);
        if (d <= CONNECT_SNAP_RADIUS && d < bestDist) {
          bestDist = d;
          best = {
            kind: i === 0 || i === path.points.length - 1 ? 'endpoint' : 'vertex',
            type: type,
            id: path.id,
            vertexIndex: i,
            end: i === 0 ? 'start' : (i === path.points.length - 1 ? 'end' : null),
            x: pt[0],
            y: pt[1],
            dist: d,
          };
        }
      }
    });
    return best;
  }

  function snapPickFromTarget(snap) {
    if (!snap) return null;
    if (snap.kind === 'node') {
      return { kind: 'node', nodeId: snap.nodeId, x: snap.x, y: snap.y };
    }
    return {
      kind: 'endpoint', type: snap.type, id: snap.id,
      vertexIndex: snap.vertexIndex, x: snap.x, y: snap.y,
    };
  }

  function updateConnectToolPointer() { /* removed — Vertex Tool replaces connect */ }

  function clearConnectToolPointer() { /* legacy no-op */ }

  function updateCutToolHover(x, y) {
    var S = sim();
    if (!S?.pathEdit?.splitToolActive) return;
    var hit = hitTestPaths(x, y, CUT_HOVER_TOLERANCE);
    if (!hit?.path) {
      S.pathEdit.cutHover = null;
      b()?.syncCutTargetCursor?.();
      b()?.requestOverlayRedraw?.();
      return;
    }
    var pts = hit.path.points;
    var p1 = pts[hit.segIndex];
    var p2 = pts[hit.segIndex + 1];
    if (!p1 || !p2) {
      S.pathEdit.cutHover = null;
      return;
    }
    S.pathEdit.cutHover = {
      pathType: hit.type, pathId: hit.id, segIndex: hit.segIndex,
      x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1],
      cx: hit.x, cy: hit.y,
    };
    b()?.syncCutTargetCursor?.();
    b()?.requestOverlayRedraw?.();
  }

  function splitBySwipe(x0, y0, x1, y1) {
    var hit = swipeIntersection(x0, y0, x1, y1);
    if (!hit) return false;
    return splitPathAt(hit.type, hit.id, hit.segIndex, [hit.x, hit.y]);
  }

  function activeCanvasTool() {
    return b()?.getActiveCanvasTool?.() || 'select';
  }

  function smartSplitAtClick(x, y) {
    var S = sim();
    if (!S?.pathEdit?.splitToolActive && activeCanvasTool() !== 'cut') return false;

    var vertexHit = null;
    iterateAllPaths(function (type, path) {
      if (vertexHit || !path?.points) return;
      var v = hitTestVertexOnPath(type, path.id, x, y, SPLIT_VERTEX_SNAP);
      if (v && v.index > 0 && v.index < path.points.length - 1) {
        vertexHit = { type: type, id: path.id, index: v.index };
      }
    });
    if (vertexHit) {
      var ref = S.selectedPath;
      var group = resolveGroupEditTarget(vertexHit.type, vertexHit.id, x, y);
      if (!ref || ref.type !== group.pathType || ref.id !== group.pathId) {
        b()?.selectPath?.(group.pathType, group.pathId, false);
      }
      return splitAtVertex(group.pathType, group.pathId, vertexHit.index);
    }

    var hit = hitTestPaths(x, y, PATH_HIT_TOLERANCE);
    if (!hit) return false;
    var groupHit = resolveGroupEditTarget(hit.type, hit.id, hit.x, hit.y);
    var sel = S.selectedPath;
    if (!sel || sel.type !== groupHit.pathType || sel.id !== groupHit.pathId) {
      b()?.selectPath?.(groupHit.pathType, groupHit.pathId, false);
    }
    var segIndex = groupHit.segIndex != null ? groupHit.segIndex : hit.segIndex;
    return splitPathAt(groupHit.pathType, groupHit.pathId, segIndex, [groupHit.x, groupHit.y]);
  }

  function hitTestEndpointOnPath(pathType, pathId, x, y, radius) {
    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts || pts.length < 2) return null;
    var tol = radius || CONNECT_SNAP_RADIUS;
    var endpoints = [0, pts.length - 1];
    for (var ei = 0; ei < endpoints.length; ei++) {
      var idx = endpoints[ei];
      var pt = pts[idx];
      if (!pt) continue;
      if (Math.hypot(pt[0] - x, pt[1] - y) <= tol) {
        return { type: pathType, id: pathId, vertexIndex: idx };
      }
    }
    return null;
  }

  function hitTestEndpointAny(x, y, radius) {
    var best = null;
    var bestDist = Infinity;
    iterateAllPaths(function (type, path) {
      if (!path?.id) return;
      var hit = hitTestEndpointOnPath(type, path.id, x, y, radius);
      if (!hit) return;
      var pt = path.points[hit.vertexIndex];
      var d = Math.hypot(pt[0] - x, pt[1] - y);
      if (d < bestDist) {
        bestDist = d;
        best = hit;
      }
    });
    return best;
  }

  function removePathByRef(pathType, pathId) {
    var S = sim();
    if (!S || !pathId) return;
    if (pathType === 'excavation') {
      S.excavationPaths = (S.excavationPaths || []).filter(function (p) { return p.id !== pathId; });
    } else {
      S.fiberCablePaths = (S.fiberCablePaths || []).filter(function (p) { return p.id !== pathId; });
    }
  }

  function mergePathsAtEndpoints(pick1, pick2, opts) {
    opts = opts || {};
    if (!pick1 || !pick2) return false;
    if (pick1.type !== pick2.type || pick1.id === pick2.id) {
      b()?.updateStatus?.('Pick endpoints on two different paths', true);
      return false;
    }
    var path1 = findPathByRef({ type: pick1.type, id: pick1.id });
    var path2 = findPathByRef({ type: pick2.type, id: pick2.id });
    if (path1?.independentClosureSegment || path2?.independentClosureSegment) return false;
    if (path1?.loopParentTrenchId === path2?.id || path2?.loopParentTrenchId === path1?.id) return false;
    var pts1 = path1?.points;
    var pts2 = path2?.points;
    if (!pts1 || !pts2 || pts1.length < 2 || pts2.length < 2) return false;

    var i1 = pick1.vertexIndex;
    var i2 = pick2.vertexIndex;
    var path1StartFree = isPathEndFree(path1, 0);
    var path1EndFree = isPathEndFree(path1, pts1.length - 1);
    var path2StartFree = isPathEndFree(path2, 0);
    var path2EndFree = isPathEndFree(path2, pts2.length - 1);
    var merged = null;
    if (i1 === pts1.length - 1 && i2 === 0) merged = pts1.concat(pts2.slice(1));
    else if (i1 === 0 && i2 === pts2.length - 1) merged = pts2.concat(pts1.slice(1));
    else if (i1 === pts1.length - 1 && i2 === pts2.length - 1) merged = pts1.concat(pts2.slice(0, -1).reverse());
    else if (i1 === 0 && i2 === 0) merged = pts1.slice().reverse().concat(pts2.slice(1));
    else {
      b()?.updateStatus?.('Connect only path endpoints', true);
      return false;
    }

    path1.points = merged.map(function (p) { return [p[0], p[1]]; });
    if (!path1.connectedTo) path1.connectedTo = { start: null, end: null };
    if (!path2.connectedTo) path2.connectedTo = { start: null, end: null };

    if (i2 === 0) path2.connectedTo.start = path1.id;
    else path2.connectedTo.end = path1.id;

    var path1KeepStart = i1 === 0 ? null : path1.connectedTo.start;
    var path1KeepEnd = i1 === pts1.length - 1 ? null : path1.connectedTo.end;
    var path2FarStart = i2 === 0 ? path2.connectedTo.end : path2.connectedTo.start;
    var path2FarEnd = i2 === pts2.length - 1 ? path2.connectedTo.start : path2.connectedTo.end;

    path1.connectedTo.start = i1 === 0 ? (path2FarStart || null) : (path1KeepStart || null);
    path1.connectedTo.end = i1 === pts1.length - 1 ? (path2FarEnd || null) : (path1KeepEnd || null);
    if (i1 === 0 && i2 === 0) path1.freeEnds = { start: false, end: path2EndFree };
    else if (i1 === 0 && i2 === pts2.length - 1) path1.freeEnds = { start: false, end: path2StartFree };
    else if (i1 === pts1.length - 1 && i2 === 0) path1.freeEnds = { start: path1StartFree, end: path2EndFree };
    else if (i1 === pts1.length - 1 && i2 === pts2.length - 1) path1.freeEnds = { start: path1StartFree, end: path2StartFree };
    else path1.freeEnds = { start: false, end: false };

    if (pick1.type === 'excavation') {
      var S = sim();
      (S.fiberCablePaths || []).forEach(function (cable) {
        if (cable.trenchPathId === pick2.id || cable.hostTrenchId === pick2.id) {
          cable.trenchPathId = pick1.id;
          cable.hostTrenchId = pick1.id;
          b()?.registerCableOnTrench?.(pick1.id, cable.id);
        }
      });
      b()?.syncCablesOnTrench?.(pick1.id);
    }

    removePathByRef(pick2.type, pick2.id);
    b()?.selectPath?.(pick1.type, pick1.id, false);
    b()?.notifyNetworkTopologyChanged?.();
    if (!opts.silent) b()?.updateStatus?.('Paths connected ✓');
    return true;
  }

  function isPathEndpointIndex(path, vertexIndex) {
    var n = path?.points?.length || 0;
    return n >= 2 && (vertexIndex === 0 || vertexIndex === n - 1);
  }

  function mergePathsAtSnapTarget(sourceRef, snapTarget) {
    if (!sourceRef || !snapTarget) return false;
    if (snapTarget.scope !== 'external') return false;
    if (sourceRef.pathType !== snapTarget.pathType) return false;
    if (sourceRef.pathId === snapTarget.pathId) return false;

    var path1 = findPathByRef({ type: sourceRef.pathType, id: sourceRef.pathId });
    var path2 = findPathByRef({ type: snapTarget.pathType, id: snapTarget.pathId });
    if (!path1?.points || !path2?.points) return false;

    var vi1 = sourceRef.vertexIndex;
    var vi2 = snapTarget.vertexIndex;
    if (!isPathEndpointIndex(path1, vi1) || !isPathEndpointIndex(path2, vi2)) return false;

    var p1 = path1.points[vi1];
    var p2 = path2.points[vi2];
    if (!p1 || !p2) return false;
    if (Math.hypot(p1[0] - p2[0], p1[1] - p2[1]) > 0.5) return false;

    return mergePathsAtEndpoints(
      { type: sourceRef.pathType, id: sourceRef.pathId, vertexIndex: vi1 },
      { type: snapTarget.pathType, id: snapTarget.pathId, vertexIndex: vi2 },
      { silent: true }
    );
  }

  function connectAtClick() { return false; /* replaced by Vertex Tool */ }

  function setCornerRadius(pathType, pathId, vertexIndex, radius) {
    var path = findPathByRef({ type: pathType, id: pathId });
    if (!path) return;
    if (!path.cornerRadii) path.cornerRadii = {};
    var r = Math.min(50, Math.max(0, radius || 0));
    if (r === 0) delete path.cornerRadii[vertexIndex];
    else path.cornerRadii[vertexIndex] = r;
    if (pathType === 'excavation') b()?.syncCablesOnTrench?.(pathId);
    else if (pathType === 'fiber') b()?.syncLockedPathFromCable?.(pathId);
    b()?.requestCanvasRedraw?.();
    global.PathwayPropertiesModal?.refresh?.();
  }

  /** Join at junction only — never drop interior loop vertices (H1 in/out). */
  function appendConnectorPreservePath(basePts, connectorPts) {
    var merged = (basePts || []).map(function (p) { return [p[0], p[1]]; });
    (connectorPts || []).forEach(function (p) {
      if (!p) return;
      var last = merged[merged.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) return;
      merged.push([p[0], p[1]]);
    });
    return merged;
  }

  function findVertexIndexNearPoint(path, x, y, tol, skipIndex) {
    if (!path?.points?.length || x == null || y == null) return null;
    tol = tol == null ? 2 : tol;
    var best = null;
    var bestDist = tol + 1;
    for (var i = 0; i < path.points.length; i++) {
      if (skipIndex != null && i === skipIndex) continue;
      var pt = path.points[i];
      if (!pt) continue;
      var d = Math.hypot(pt[0] - x, pt[1] - y);
      if (d <= tol && d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  }

  function inferReconnectToVertex(path, draftPoints, skipFromIndex) {
    if (!path?.points?.length || !draftPoints?.length) return null;
    var last = draftPoints[draftPoints.length - 1];
    if (!last) return null;
    return findVertexIndexNearPoint(path, last[0], last[1], RECONNECT_SNAP_RADIUS, skipFromIndex);
  }

  function buildConnectorRenderPoints(path, segment) {
    if (!path?.points?.length || !segment) return [];
    var fromVi = segment.fromVertexIndex;
    var anchor = path.points[fromVi];
    if (!anchor) return (segment.points || []).slice();
    var out = [[anchor[0], anchor[1]]];
    (segment.points || []).forEach(function (p) {
      if (!p) return;
      var last = out[out.length - 1];
      if (last && last[0] === p[0] && last[1] === p[1]) return;
      out.push([p[0], p[1]]);
    });
    if (segment.toVertexIndex != null && path.points[segment.toVertexIndex]) {
      var toPt = path.points[segment.toVertexIndex];
      var tail = out[out.length - 1];
      if (!tail || tail[0] !== toPt[0] || tail[1] !== toPt[1]) {
        out.push([toPt[0], toPt[1]]);
      }
    }
    return out.length >= 2 ? out : [];
  }

  function buildConnectorSegmentPayload(path, fromVi, toVi, draftPts, draft) {
    var connector = (draftPts || []).slice(1).map(function (p) { return [p[0], p[1]]; });
    if (toVi != null && connector.length && path?.points?.[toVi]) {
      var toPt = path.points[toVi];
      var last = connector[connector.length - 1];
      if (last && Math.hypot(last[0] - toPt[0], last[1] - toPt[1]) <= 2.5) {
        connector = connector.slice(0, -1);
      }
    }
    return {
      fromVertexIndex: fromVi,
      toVertexIndex: toVi,
      points: connector,
      snapLabels: (draft?.snapLabels || []).slice(1),
      pointSnapNodeIds: (draft?.pointSnapNodeIds || []).slice(1),
    };
  }

  function buildConnectedToFromSnapLabels(snapLabels) {
    var start = null;
    var end = null;
    (snapLabels || []).forEach(function (lbl) {
      if (!lbl) return;
      if (!start) start = lbl;
      end = lbl;
    });
    return { start: start, end: end };
  }

  function getHandholeLinkLabel(node) {
    if (!node) return null;
    return node.autoName || node.fatSystemName || node.closureName || null;
  }

  function collectHandholeLabelsFromPath(path) {
    var S = sim();
    var labels = [];
    var seen = {};

    function add(label) {
      if (!label || seen[label]) return;
      seen[label] = 1;
      labels.push(label);
    }

    function pointNearNode(pt, node, tol) {
      if (!pt || !node || !S?.layout) return false;
      var cs = S.layout.cellSize || 50;
      var x = node.col * cs + cs / 2;
      var y = node.row * cs + cs / 2;
      return Math.hypot(pt[0] - x, pt[1] - y) <= tol;
    }

    if (!path) return labels;
    var ct = path.connectedTo || {};
    add(ct.start);
    add(ct.end);
    (path.snapLabels || []).forEach(add);
    (path.associatedHandholeLabels || []).forEach(add);

    var cs = S?.layout?.cellSize || 50;
    var tol = cs * 0.65;
    (S?.nodes || []).forEach(function (node) {
      if (!node || (node.type !== 'handhole' && node.type !== 'fat_handhole')) return;
      var label = getHandholeLinkLabel(node);
      if (!label) return;
      for (var i = 0; i < (path.points || []).length; i++) {
        if (pointNearNode(path.points[i], node, tol)) {
          add(label);
          break;
        }
      }
    });

    return labels;
  }

  function createIndependentTrenchPath(points, kind, snapLabels, pointSnapNodeIds, parentPathId, associatedHandholeLabels) {
    var S = sim();
    if (!S) return null;
    var pts = (points || []).map(function (p) { return [p[0], p[1]]; });
    if (!pts || pts.length < 2) return null;

    var labels = (snapLabels || []).slice(0, pts.length);
    var nodes = (pointSnapNodeIds || []).slice(0, pts.length);
    while (labels.length < pts.length) labels.push(null);
    while (nodes.length < pts.length) nodes.push(null);
    var associatedLabels = [];
    var seenAssoc = {};
    function addAssociated(label) {
      if (!label || seenAssoc[label]) return;
      seenAssoc[label] = 1;
      associatedLabels.push(label);
    }
    (associatedHandholeLabels || []).forEach(addAssociated);
    labels.forEach(addAssociated);

    S.excavationPathId++;
    var connectedTo = buildConnectedToFromSnapLabels(labels);
    var newPath = {
      id: 'excavation_' + S.excavationPathId,
      type: 'LM_Excavation',
      kind: kind || 'direct_buried',
      points: pts,
      cornerRadii: {},
      connectedTo: connectedTo,
      freeEnds: { start: !connectedTo.start, end: !connectedTo.end },
      snapLabels: labels,
      pointSnapNodeIds: nodes,
      loopParentTrenchId: parentPathId || null,
      associatedHandholeLabels: associatedLabels,
      independentClosureSegment: true,
      noAutoMerge: true,
    };
    S.excavationPaths.push(newPath);
    return newPath;
  }

  function createIndependentTrenchSegment(parentPath, segmentPayload, draft) {
    if (!parentPath || !segmentPayload) return null;
    var pts = buildConnectorRenderPoints(parentPath, segmentPayload);
    return createIndependentTrenchPath(
      pts,
      parentPath.kind || draft?.kind || 'direct_buried',
      segmentPayload.snapLabels || draft?.snapLabels || [],
      segmentPayload.pointSnapNodeIds || draft?.pointSnapNodeIds || [],
      parentPath.id,
      collectHandholeLabelsFromPath(parentPath)
    );
  }

  function addConnectorSegment(path, segment) {
    if (!path || !segment) return false;
    if (!path.connectorSegments) path.connectorSegments = [];
    path.connectorSegments.push(segment);
    return true;
  }

  function extendPathVertexMetadata(path, oldLen, draft, connectorStartIndex) {
    connectorStartIndex = connectorStartIndex == null ? 1 : connectorStartIndex;
    if (!path) return;
    if (!path.snapLabels) path.snapLabels = [];
    if (!path.pointSnapNodeIds) path.pointSnapNodeIds = [];
    while (path.snapLabels.length < oldLen) path.snapLabels.push(null);
    while (path.pointSnapNodeIds.length < oldLen) path.pointSnapNodeIds.push(null);
    var labels = draft.snapLabels || [];
    var nodes = draft.pointSnapNodeIds || [];
    for (var di = connectorStartIndex; di < (draft.points || []).length; di++) {
      path.snapLabels.push(labels[di] || null);
      path.pointSnapNodeIds.push(nodes[di] || null);
    }
    if (!path.connectedTo) path.connectedTo = { start: null, end: null };
    var startLabel = path.connectedTo.start;
    var endLabel = path.connectedTo.end;
    (path.snapLabels || []).forEach(function (lbl) {
      if (!lbl) return;
      if (!startLabel) startLabel = lbl;
      endLabel = lbl;
    });
    path.connectedTo.start = startLabel;
    path.connectedTo.end = endLabel;
    if (path.freeEnds) {
      path.freeEnds.start = !path.connectedTo.start;
      path.freeEnds.end = !path.connectedTo.end;
    }
  }

  function mergeReconnect(draft) {
    var S = sim();
    var rc = draft?.reconnectFrom;
    var rt = draft?.reconnectTo;
    if (!S || !rc || !draft?.points?.length) return false;
    var path = findPathByRef({ type: rc.type, id: rc.id });
    var pts = path?.points;
    if (!pts?.length) return false;

    var draftPts = draft.points.map(function (p) { return [p[0], p[1]]; });
    var fromVi = rc.vertexIndex;
    if (fromVi == null && rc.end === 'start') fromVi = 0;
    else if (fromVi == null && rc.end === 'end') fromVi = pts.length - 1;
    if (fromVi == null && draftPts.length) {
      fromVi = findVertexIndexNearPoint(path, draftPts[0][0], draftPts[0][1], 2.5, null);
    }

    var toVi = rt?.type === rc.type && rt?.id === rc.id ? rt.vertexIndex : null;
    if (toVi == null) toVi = inferReconnectToVertex(path, draftPts, fromVi);

    var closesOnSamePath = toVi != null && fromVi != null && toVi !== fromVi;
    var closesAcrossExcavations = rc.type === 'excavation' && rt?.type === 'excavation' &&
      rt.id && rt.id !== rc.id && draftPts.length >= 2;
    var extendsFromEndpoint = fromVi === 0 || fromVi === pts.length - 1;
    var skipAutoMerge = closesOnSamePath;

    if (closesAcrossExcavations) {
      // Triangle base drawn between two trench legs: keep it as the next standalone trench ID.
      var targetPath = findPathByRef({ type: rt.type, id: rt.id });
      var associatedLabels = collectHandholeLabelsFromPath(path).concat(collectHandholeLabelsFromPath(targetPath));
      var bridgeSeg = createIndependentTrenchPath(
        draftPts,
        path.kind || draft?.kind || 'direct_buried',
        draft.snapLabels || [],
        draft.pointSnapNodeIds || [],
        path.id,
        associatedLabels
      );
      if (!bridgeSeg) return false;
      b()?.saveState?.();
      b()?.requestCanvasRedraw?.();
      b()?.renderUnifiedSidebar?.();
      b()?.updateMetrics?.();
      return { type: 'excavation', id: bridgeSeg.id };
    } else if (closesOnSamePath) {
      // Triangle closure chord — independent trench segment with its own excavation ID.
      var closureSeg = createIndependentTrenchSegment(
        path,
        buildConnectorSegmentPayload(path, fromVi, toVi, draftPts, draft),
        draft
      );
      if (!closureSeg) return false;
      skipAutoMerge = true;
      b()?.saveState?.();
      b()?.requestCanvasRedraw?.();
      b()?.renderUnifiedSidebar?.();
      b()?.updateMetrics?.();
      return { type: 'excavation', id: closureSeg.id };
    } else if (extendsFromEndpoint && rc.end === 'start') {
      path.points = appendConnectorPreservePath(
        draftPts.slice().reverse(),
        pts.slice(1)
      );
      extendPathVertexMetadata(path, pts.length, draft, 1);
    } else if (extendsFromEndpoint) {
      var oldLen = pts.length;
      path.points = appendConnectorPreservePath(pts, draftPts.slice(1));
      extendPathVertexMetadata(path, oldLen, draft, 1);
    } else if (fromVi != null) {
      // Interior spur: connected segment — preserve full main polyline (H1 loop intact).
      addConnectorSegment(path, buildConnectorSegmentPayload(path, fromVi, null, draftPts, draft));
      skipAutoMerge = true;
    } else {
      path.points = appendConnectorPreservePath(pts, draftPts.slice(1));
    }

    if (rc.type === 'excavation') {
      b()?.syncCablesOnTrench?.(rc.id);
      if (!skipAutoMerge) b()?.tryAutoMergePathGaps?.('excavation', rc.id);
    }
    b()?.saveState?.();
    b()?.requestCanvasRedraw?.();
    b()?.renderUnifiedSidebar?.();
    return true;
  }

  function isVertexToolActive() {
    return !!(b()?.getActiveCanvasTool?.() === 'vertex' || sim()?.pathEdit?.vertexToolActive);
  }

  function beginVertexDragFromPick(e, pick) {
    var S = sim();
    if (!pick || S?.pathEdit?.ghostDragging) return false;
    if (!isVertexToolActive()) return false;

    var vertexIndex = pick.index;
    if (vertexIndex == null || vertexIndex < 0) return false;

    var path = findPathByRef({ type: pick.pathType, id: pick.pathId });
    var pt = path?.points?.[vertexIndex];
    if (!pt) return false;

    e.preventDefault();
    e.stopPropagation();

    return global.FTTHDrawingEngine?.beginGhostVertexDrag?.({
      pathType: pick.pathType,
      pathId: pick.pathId,
      vertexIndex: vertexIndex,
      origin: [pt[0], pt[1]],
      ghostPosition: { x: pt[0], y: pt[1] },
      isNewVertex: false,
    }) || false;
  }

  function beginVertexGhostInsertFromHover(e, hover) {
    var S = sim();
    if (!hover || S?.pathEdit?.ghostDragging) return false;
    if (!isVertexToolActive()) return false;

    e.preventDefault();
    e.stopPropagation();

    return global.FTTHDrawingEngine?.beginGhostVertexDrag?.({
      pathType: hover.pathType,
      pathId: hover.pathId,
      isNewVertex: true,
      insertSegIndex: hover.segIndex,
      ghostPosition: { x: hover.x, y: hover.y },
    }) || false;
  }

  function beginVertexDrag(e, handleEl) {
    if (!handleEl) return false;
    var xy = svgCoords(e);
    if (!xy) return false;
    var pathType = handleEl.getAttribute('data-path-type');
    var pathId = handleEl.getAttribute('data-path-id');
    if (!pathType || !pathId) return false;
    var pick = pickVertexDragTarget(xy.x, xy.y, e.clientX, e.clientY);
    if (!pick || pick.pathType !== pathType || pick.pathId !== pathId) return false;
    return beginVertexDragFromPick(e, pick);
  }

  function endVertexDrag(e) {
    finishVertexGhostDrag(e);
  }

  function onPathEditDragMove(e) {
    global.FTTHDrawingEngine?.updateGhostPositionFromEvent?.(e);
  }

  function renderVertexHandles(svg, pathObj, pathType) {
    var pts = pathObj?.points;
    if (!svg || !pts?.length) return;
    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'vertex-handles');
    g.setAttribute('pointer-events', 'none');
    var size = 4;
    pts.forEach(function (pt, i) {
      if (!pt) return;
      var diamond = document.createElementNS(SVG_NS, 'polygon');
      diamond.setAttribute('class', 'vertex-handle');
      diamond.setAttribute('points', diamondPoints(pt[0], pt[1], size));
      diamond.setAttribute('fill', '#7c3aed');
      diamond.setAttribute('stroke', '#ffffff');
      diamond.setAttribute('stroke-width', '1');
      diamond.setAttribute('filter', 'none');
      diamond.setAttribute('pointer-events', 'none');
      diamond.setAttribute('data-path-type', pathType);
      diamond.setAttribute('data-path-id', pathObj.id);
      diamond.setAttribute('data-vertex-index', String(i));
      g.appendChild(diamond);
    });
    svg.appendChild(g);
  }

  function deleteVertexAt(pathType, pathId, vertexIndex) {
    var path = findPathByRef({ type: pathType, id: pathId });
    var pts = path?.points;
    if (!pts || pts.length <= 2) {
      b()?.updateStatus?.('Path needs at least 2 vertices', true);
      return false;
    }
    if (vertexIndex <= 0 || vertexIndex >= pts.length - 1) {
      b()?.updateStatus?.('Cannot delete endpoint vertices', true);
      return false;
    }
    pts.splice(vertexIndex, 1);
    var cr = path.cornerRadii || {};
    var newCr = {};
    Object.keys(cr).forEach(function (k) {
      var ki = parseInt(k, 10);
      if (isNaN(ki)) return;
      if (ki < vertexIndex) newCr[ki] = cr[k];
      else if (ki > vertexIndex) newCr[ki - 1] = cr[k];
    });
    path.cornerRadii = newCr;
    b()?.propagateLockedVertexDelete?.(pathType, pathId, vertexIndex);
    if (pathType === 'excavation') b()?.syncCablesOnTrench?.(pathId);
    else if (pathType === 'fiber') b()?.syncLockedPathFromCable?.(pathId);
    b()?.saveState?.();
    return true;
  }

  function navigateVertex(delta) {
    var S = sim();
    var ref = S?.selectedPath;
    if (!ref) return false;
    var path = findPathByRef(ref);
    var n = path?.points?.length || 0;
    if (!n) return false;
    if (!S.pathEdit) S.pathEdit = { drag: null, context: null };
    var cur = S.pathEdit.selectedVertexIndex;
    if (cur == null) cur = 0;
    S.pathEdit.selectedVertexIndex = (cur + delta + n) % n;
    b()?.requestCanvasRedraw?.();
    b()?.syncVertexControlBar?.();
    global.PathwayPropertiesModal?.refresh?.();
    return true;
  }

  function addVertexAtSelection() {
    var S = sim();
    var ref = S?.selectedPath;
    if (!ref) return false;
    var path = findPathByRef(ref);
    var pts = path?.points;
    if (!pts || pts.length < 2) return false;
    if (!S.pathEdit) S.pathEdit = { drag: null, context: null };
    var idx = S.pathEdit.selectedVertexIndex;
    if (idx == null) idx = 0;
    var segIndex = idx < pts.length - 1 ? idx : Math.max(0, idx - 1);
    var newIdx = insertVertexAtMidpoint(ref.type, ref.id, segIndex);
    if (newIdx < 0) return false;
    S.pathEdit.selectedVertexIndex = newIdx;
    b()?.saveState?.();
    b()?.requestCanvasRedraw?.();
    b()?.syncVertexControlBar?.();
    global.PathwayPropertiesModal?.refresh?.();
    b()?.updateStatus?.('Vertex added — drag to position');
    return true;
  }

  function deleteSelectedVertex() {
    var S = sim();
    var ref = S?.selectedPath;
    if (!ref) return false;
    var idx = S.pathEdit?.selectedVertexIndex;
    if (idx == null) return false;
    if (!deleteVertexAt(ref.type, ref.id, idx)) return false;
    var path = findPathByRef(ref);
    var n = path?.points?.length || 0;
    S.pathEdit.selectedVertexIndex = Math.min(idx, Math.max(0, n - 1));
    b()?.requestCanvasRedraw?.();
    b()?.syncVertexControlBar?.();
    global.PathwayPropertiesModal?.refresh?.();
    b()?.updateStatus?.('Vertex deleted');
    return true;
  }

  function renderMidpointHandles(svg, pathObj, pathType) {
    var pts = pathObj?.points;
    if (!svg || !pts || pts.length < 2) return;
    var g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'midpoint-handles');
    var size = 4;
    for (var i = 0; i < pts.length - 1; i++) {
      var p1 = pts[i];
      var p2 = pts[i + 1];
      if (!p1 || !p2) continue;
      var mx = (p1[0] + p2[0]) / 2;
      var my = (p1[1] + p2[1]) / 2;
      var diamond = document.createElementNS(SVG_NS, 'polygon');
      diamond.setAttribute('class', 'midpoint-handle');
      diamond.setAttribute('points',
        mx + ',' + (my - size) + ' ' +
        (mx + size) + ',' + my + ' ' +
        mx + ',' + (my + size) + ' ' +
        (mx - size) + ',' + my
      );
      diamond.setAttribute('fill', 'none');
      diamond.setAttribute('stroke', '#dc2626');
      diamond.setAttribute('stroke-width', '1.5');
      diamond.setAttribute('filter', 'none');
      diamond.setAttribute('data-path-type', pathType);
      diamond.setAttribute('data-path-id', pathObj.id);
      diamond.setAttribute('data-seg-index', String(i));
      g.appendChild(diamond);
    }
    svg.appendChild(g);
  }

  function bindCanvasInteraction() {
    if (sim()?.ui?.pathEditorBound) return;
    var canvas = b()?.getDrawingCanvas?.();
    if (!canvas) return;

    function pickEquipmentNodeId(e) {
      return b()?.pickPlacedNodeUnderPointer?.(e.clientX, e.clientY) || null;
    }

    function applyResolvedMapPick(e) {
      var pick = b()?.resolveMapPick?.(e.clientX, e.clientY);
      if (!pick) return false;
      return !!b()?.applyMapPick?.(pick, e);
    }

    function isPathMapPickTarget(e) {
      var pathEl = e.target.closest?.('.draw-path-hit, .svg-pathway-line');
      if (pathEl?.getAttribute?.('data-path-type')) return true;
      var xy = svgCoords(e);
      if (!xy) return false;
      return !!pickPathHitAtPoint(xy.x, xy.y, PATH_HIT_TOLERANCE);
    }

    /** Hand tool: defer to pointerup so drag still pans; commit uses Selection tool pick logic. */
    function scheduleHandToolMapPick(e) {
      if (b()?.canPenDraw?.()) return false;
      if (!isPathMapPickTarget(e)) return false;
      var S = sim();
      if (!S) return false;
      S.ui = S.ui || {};
      S.ui.handPathPick = { x: e.clientX, y: e.clientY };
      var downX = e.clientX;
      var downY = e.clientY;
      e.preventDefault();
      e.stopPropagation();
      function onHandPathUp(upEv) {
        document.removeEventListener('pointerup', onHandPathUp, true);
        if (S.ui) S.ui.handPathPick = null;
        var dx = upEv.clientX - downX;
        var dy = upEv.clientY - downY;
        if (Math.hypot(dx, dy) < 6) {
          applyResolvedMapPick(upEv);
        }
      }
      document.addEventListener('pointerup', onHandPathUp, true);
      return true;
    }

    function onDown(e) {
      if (e.button === 2) {
        if (global.FTTHDrawingEngine?.isGhostSessionActive?.()) {
          global.FTTHDrawingEngine.resetAllGhostState?.();
          b()?.renderGlobalDrawingLayer?.();
          b()?.updateStatus?.('Vertex edit cancelled');
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (e.button !== 0) return;
      var S = sim();

      /* Cable pen first: DrawingEngine cues → save trails → FiberDesignManager matrix */
      if (b()?.isCablePenDrawActive?.()) {
        if (global.FTTHDrawingEngine?.onPenPointerDown?.(e)) return;
      }

      if (b()?.canPenDraw?.()) {
        if (global.FTTHDrawingEngine?.onPenPointerDown?.(e)) return;
      }

      if (isVertexToolActive()) {
        if (global.FTTHDrawingEngine?.routeVertexPointerDown?.(e)) return;
        if (global.FTTHDrawingEngine?.routePointerDown?.(e)) return;
      }

      if (b()?.getActiveCanvasTool?.() === 'cut' || S?.pathEdit?.splitToolActive) {
        if (global.FTTHDrawingEngine?.routePointerDown?.(e)) return;
      }

      if (!global.FTTHDrawingEngine?.isGhostSessionActive?.()) {
        var allowMapPick = S?.interactionMode !== 'hand' && !b()?.canPenDraw?.();
        if (allowMapPick) {
          if (applyResolvedMapPick(e)) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
      }

      if (S?.pathEdit?.ghostDragging) return;

      if (S?.interactionMode === 'hand') {
        if (S?.pathEdit?.splitToolActive) {
          if (global.FTTHDrawingEngine?.routePointerDown?.(e)) return;
          return;
        }
        if (!S.pathEdit?.editActive && !S.pathEdit?.splitToolActive &&
            !S.pathEdit?.vertexToolActive) {
          if (!b()?.canPenDraw?.()) {
            var handEquipId = pickEquipmentNodeId(e);
            if (handEquipId && e.target.closest?.('.placed-node')) {
              return;
            }
          }
          if (scheduleHandToolMapPick(e)) return;
        }
        return;
      }

      if (!b()?.isDrawingLayerInteractive?.()) return;

      if (global.FTTHDrawingEngine?.routePointerDown?.(e)) return;

      if (!e.target.closest?.('.vertex-handle, .midpoint-handle')) {
        var xySwitch = svgCoords(e);
        if (xySwitch && !b()?.hasActiveDrawingStroke?.()) {
          var pathHit = pickPathHitAtPoint(xySwitch.x, xySwitch.y, PATH_HIT_TOLERANCE);
          if (pathHit) {
            e.preventDefault();
            e.stopPropagation();
            /* Same map-pick path as Hand tool — isolates yellow highlight + Evaluation. */
            b()?.applyMapPick?.({
              kind: 'path',
              type: pathHit.type,
              id: pathHit.id,
              segIndex: pathHit.segIndex,
            }, e);
            return;
          }
        }
      }

      if (!S?.pathEdit?.editActive) {
        if (e.target.closest?.('.placed-node')) return;
        var xySel = svgCoords(e);
        if (!xySel) return;
        if (!b()?.canPenDraw?.() || !S?.penDraft) {
          if (applyResolvedMapPick(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
        return;
      }

      var xy = svgCoords(e);
      if (!xy) return;

      if (S?.selectedPath) {
        var pickVtx = pickVertexDragTarget(xy.x, xy.y, e.clientX, e.clientY);
        if (pickVtx) {
          beginVertexDragFromPick(e, pickVtx);
          return;
        }
      }
    }

    function onMove(e) {
      var S = sim();
      if (S?.pathEdit?.ghostDragging) return;

      if (global.FTTHDrawingEngine?.routePointerMove?.(e)) return;

      if (S?.interactionMode === 'hand') return;

      if (b()?.canPenDraw?.()) {
        if (!global.FTTHDrawingEngine?.isPenPointerTrackingActive?.()) {
          global.FTTHDrawingEngine?.updateRubberBandFromEvent?.(e);
        }
        return;
      }
      if (b()?.isPlacementToolActive?.()) return;
      if (!b()?.isDrawingLayerInteractive?.()) return;
      if (b()?.canVertexEdit?.()) {
        global.FTTHDrawingEngine?.updateCrosshairFromEvent?.(e);
      }
      var xy = svgCoords(e);
      if (!xy) return;
      var hit = hitTestPaths(xy.x, xy.y, PATH_HIT_TOLERANCE);
      b()?.setHoveredPath?.(hit ? hit.type : null, hit ? hit.id : null, hit ? hit.segIndex : null);
    }

    function onUp(e) {
      if (global.FTTHDrawingEngine?.routePointerUp?.(e)) return;
    }

    function onDblClick(e) {
      if (b()?.tryHandholeQuickNestDblClick?.(e)) return;
      if (b()?.trySelectionModeDblClick?.(e)) return;
      if (global.FTTHDrawingEngine?.routeVertexDblClick?.(e)) return;
      if (global.FTTHDrawingEngine?.onPenDblClick?.(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
        return;
      }
    }

    function onCanvasLeave() {
      global.FTTHDrawingEngine?.setCrosshairMapHover?.(false);
      if (global.FTTHDrawingEngine?.isGhostSessionActive?.()) {
        global.FTTHDrawingEngine.resetAllGhostState?.();
        b()?.renderGlobalDrawingLayer?.();
      }
      b()?.resetMapPointerState?.();
    }

    /* Capture phase — run before .placed-node stopPropagation (workspace-items-layer z-120). */
    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, false);
    canvas.addEventListener('pointerup', onUp, false);
    canvas.addEventListener('dblclick', onDblClick, true);
    canvas.addEventListener('mouseleave', onCanvasLeave);

    var grid = document.getElementById('city-grid');
    if (grid && !sim()?.ui?.gridDblBound) {
      grid.addEventListener('dblclick', function (e) {
        if (b()?.tryHandholeQuickNestDblClick?.(e)) return;
        if (global.FTTHDrawingEngine?.onPenDblClick?.(e)) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
          return;
        }
        b()?.trySelectionModeDblClick?.(e);
      }, true);
      var uiGrid = sim()?.ui;
      if (uiGrid) uiGrid.gridDblBound = true;
    }

    var wrap = document.getElementById('canvas-wrapper');
    if (wrap && !sim()?.ui?.canvasLeaveBound) {
      wrap.addEventListener('mouseleave', onCanvasLeave);
      var uiLeave = sim()?.ui;
      if (uiLeave) uiLeave.canvasLeaveBound = true;
    }

    var ui = sim()?.ui;
    if (ui) ui.pathEditorBound = true;
  }

  global.FTTHPathwayEditor = {
    PATH_HIT_TOLERANCE: PATH_HIT_TOLERANCE,
    VERTEX_HIT_RADIUS: VERTEX_HIT_RADIUS,
    init: function (deps) { bridge = deps; },
    bindCanvasInteraction: bindCanvasInteraction,
    iterateAllPaths: iterateAllPaths,
    hitTestPaths: hitTestPaths,
    hitTestPathsAll: hitTestPathsAll,
    pickPathHitAtPoint: pickPathHitAtPoint,
    hitTestVertexOnPath: hitTestVertexOnPath,
    hitTestVertexOnAnyPath: hitTestVertexOnAnyPath,
    hitTestVertexOnSelected: hitTestVertexOnSelected,
    hitTestMidpointOnSelected: hitTestMidpointOnSelected,
    hitTestSegmentInsertOnSelected: hitTestSegmentInsertOnSelected,
    pickVertexDragTarget: pickVertexDragTarget,
    insertVertexOnSegment: insertVertexOnSegment,
    beginVertexDragFromPick: beginVertexDragFromPick,
    beginVertexGhostInsertFromHover: beginVertexGhostInsertFromHover,
    finishVertexGhostDrag: finishVertexGhostDrag,
    cancelVertexDrag: cancelVertexDrag,
    addVertexAtDblClick: addVertexAtDblClick,
    pointsToD: pointsToD,
    getPathLength: getPathLength,
    measurePathD: measurePathD,
    insertVertexAtMidpoint: insertVertexAtMidpoint,
    splitPathAt: splitPathAt,
    smartSplitAtClick: smartSplitAtClick,
    splitBySwipe: splitBySwipe,
    findConnectSnapTarget: findConnectSnapTarget,
    findNearestPathVertex: findNearestPathVertex,
    findFreeExcavationEndpointNear: findFreeExcavationEndpointNear,
    inferReconnectTargetAnyExcavation: inferReconnectTargetAnyExcavation,
    collectExcavationReconnectVertices: collectExcavationReconnectVertices,
    findPathByRef: findPathByRef,
    inferReconnectToVertex: inferReconnectToVertex,
    RECONNECT_SNAP_RADIUS: RECONNECT_SNAP_RADIUS,
    buildConnectorRenderPoints: buildConnectorRenderPoints,
    updateConnectToolPointer: updateConnectToolPointer,
    updateCutToolHover: updateCutToolHover,
    clearConnectToolPointer: clearConnectToolPointer,
    mergePathsAtEndpoints: mergePathsAtEndpoints,
    mergePathsAtSnapTarget: mergePathsAtSnapTarget,
    setCornerRadius: setCornerRadius,
    mergeReconnect: mergeReconnect,
    onPathEditDragMove: onPathEditDragMove,
    renderVertexHandles: renderVertexHandles,
    renderMidpointHandles: renderMidpointHandles,
    updateVertexHandlesInPlace: updateVertexHandlesInPlace,
    navigateVertex: navigateVertex,
    addVertexAtSelection: addVertexAtSelection,
    deleteSelectedVertex: deleteSelectedVertex,
    deleteVertexAt: deleteVertexAt,
  };
})(window);
