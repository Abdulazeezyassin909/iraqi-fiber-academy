# Runtime Refresh & Production Cleanup Report

**Date:** 2026-08-04  
**Scope:** Production-safe runtime performance, memory reduction, and debug cleanup.  
**Constraints honored:** No functional, UI, cable-drawing, Fiber Design logic, pathBridge, or architecture changes.

---

## Summary

| Category | Result |
|----------|--------|
| Global DEBUG flag | `window.FTTH_DEBUG = false` in `simulator.html` |
| Console logs gated | **87** `log` / `warn` / `info` / `debug` calls wrapped |
| Debug scripts disabled | `keyboard-debug.js`, `fatPoleTransformSpy.js` removed from HTML load |
| `console.error` preserved | **41** calls unchanged across active modules |
| Rendering optimizations | 3 targeted changes (see below) |
| Files moved/renamed/split | **None** |

---

## 1. DEBUG Logging System

### Global flag

```html
<!-- simulator.html (before runtime scripts) -->
<script>window.FTTH_DEBUG = false;</script>
```

Each active module reads:

```javascript
var DEBUG = !!(global && global.FTTH_DEBUG);
```

Set `window.FTTH_DEBUG = true` in the browser console (or edit `simulator.html`) to re-enable diagnostic output without code changes.

### Logs converted to DEBUG mode

| File | `log` | `warn` | `info` | `debug` | Total |
|------|------:|-------:|-------:|--------:|------:|
| `js/FiberDesignManager.js` | 45 | 1 | 0 | 0 | **46** |
| `js/FiberDesignUI.js` | 17 | 0 | 0 | 0 | **17** |
| `js/ftth-simulator-core.js` | 12 | 9 | 1 | 0 | **22** |
| `js/drawingEngine.js` | 1 | 0 | 0 | 0 | **1** |
| `js/fileMenuBar.js` | 0 | 1 | 0 | 0 | **1** |
| **Total wrapped** | | | | | **87** |

All wrapped using:

```javascript
if (DEBUG) {
  console.log(/* ... */);
}
```

### Preserved (not gated)

- All `console.error` calls (critical failures, matrix button errors, FiberDesign validation errors, fullscreen request failures, etc.)
- UI status text via `updateStatus()` — only the duplicate `console.warn` side-channel is gated

### Cable / save functions

`saveCableToDatabase()`, `extendCableInDatabase()`, and `finishPenDrawing()` were **not modified logically**. Existing diagnostic `console.log` / `console.warn` inside them were wrapped in `if (DEBUG)` only.

---

## 2. Debug-Only Runtime Overhead Removed

| Script | Status | Reason |
|--------|--------|--------|
| `js/keyboard-debug.js` | **Unloaded** | Keyboard/focus spy; header documents removal from HTML to disable |
| `js/fatPoleTransformSpy.js` | **Unloaded** | DOM transform audit spy; hooks `__FTTH_AUDIT_POLE_TRANSFORM__` |

Both files remain on disk for developer use but are no longer parsed or executed at startup.

**Estimated savings:** ~19 console calls per interaction eliminated; no capture-phase keyboard listeners; no prototype/setAttribute transform hooks.

---

## 3. Rendering Performance Review

### Handlers audited

| Handler | Location | Finding |
|---------|----------|---------|
| `document.mousemove` (crosshair) | `drawingEngine.js` | Was uncapped; **rAF-coalesced** |
| `wrap.pointermove` (coords) | `ftth-simulator-core.js` | `getElementById` every move; **element cached** |
| `wrap.pointermove` (canvas track) | `ftth-simulator-core.js` | Lightweight coord store only — OK |
| `document.pointermove` (pan) | `ftth-simulator-core.js` | Already routes through `scheduleMapViewportTransform` (rAF) |
| `wrap.wheel` (zoom) | `ftth-simulator-core.js` | Already uses `scheduleWheelZoomAnimation` (rAF) |
| `flushMapViewportTransform` | `ftth-simulator-core.js` | FAT marker audit ran every flush; **gated behind DEBUG** |
| `requestCanvasRedraw` / `requestOverlayRedraw` | `ftth-simulator-core.js` | Already rAF-coalesced — no change |
| `LabelManager.scheduleRender` | `LabelManager.js` | Already rAF-coalesced — no change |
| Rubber band pen cursor | `drawingEngine.js` | Already uses `rubberBandRaf` — no change |

### Optimizations applied

1. **FAT rigid marker auto-audit** (`flushMapViewportTransform`): Entire debug block — multiple `querySelector`, `getComputedStyle`, `getBoundingClientRect`, and `__FTTH_AUDIT_POLE_TRANSFORM__` — now runs only when `DEBUG === true`. The functional `ftth-map-transform` CustomEvent dispatch is unchanged.

2. **Crosshair hover detection** (`drawingEngine.js`): Document-level `mousemove` now coalesces through `scheduleCrosshairMapHoverCheck()` (max one hit-test per animation frame). `setCrosshairMapHover` still early-returns when state is unchanged.

3. **GIS status bar coordinates** (`ftth-simulator-core.js`): `#status-bar-coords` element reference cached on `Sim.ui.gisStatusBarCoordsEl` after first lookup.

### Not changed (intentional)

- `LabelManager.refresh()` on every map transform — required for overlay label alignment during pan/zoom
- `applyViewportCullingToPlacedNodes()` on transform — functional culling
- `quarantineFatRigidMarkerChildren` in transform `finally` — functional guard, not debug

---

## 4. Map Responsiveness Review

| Aspect | Before | After |
|--------|--------|-------|
| Pan | rAF-coalesced via `scheduleMapViewportTransform` | Same; debug audit removed from hot path |
| Zoom | rAF wheel animation | Unchanged |
| Crosshair | Hit-test on every mousemove (~500–1000 Hz) | Hit-test capped at display refresh rate |
| Console during pan/zoom | FAT audit object logged every frame when debugging | Silent in production |

---

## 5. Memory Cleanup

| Item | Action |
|------|--------|
| Debug script listeners | Removed by unloading `keyboard-debug.js` and `fatPoleTransformSpy.js` |
| Transform spy closures | No longer installed at boot |
| Status bar DOM cache | Single persistent reference; avoids repeated allocation of lookup strings |
| Crosshair rAF | Reuses one pending `{x,y}` object per frame; no listener leaks introduced |

No event listeners were removed from functional code paths.

---

## 6. Files Reviewed (Active Runtime)

All scripts loaded by `simulator.html`:

| File | DEBUG logs | Perf change |
|------|:----------:|:-----------:|
| `simulator.html` | Flag added | Debug scripts removed |
| `js/drawingEngine.js` | 1 | Crosshair rAF |
| `js/pathwayEditor.js` | — | Reviewed, no logs |
| `js/PathwayPropertiesModal.js` | — | Reviewed |
| `js/LabelManager.js` | — | Reviewed (existing rAF) |
| `js/uiController.js` | — | Reviewed |
| `js/settings/SimulatorSettings.js` | — | Reviewed |
| `js/labels/LabelDataProviders.js` | — | Reviewed |
| `js/FiberDesignManager.js` | 46 | Reviewed |
| `js/FiberDesignUI.js` | 17 | Reviewed |
| `js/FiberDesignMatrixModal.js` | — | Reviewed |
| `js/SplicingActionUI.js` | — | Reviewed |
| `js/toolboxInventoryPanel.js` | — | Reviewed |
| `js/VisibilityManager.js` | — | Reviewed |
| `js/toolboxManager.js` | — | Reviewed |
| `js/fileMenuBar.js` | 1 | Reviewed |
| `js/projectSetupModal.js` | — | Reviewed |
| `js/startupView.js` | — | Reviewed |
| `js/ftth-simulator-core.js` | 22 | FAT audit gate + coords cache |
| `js/main.js` | — | Reviewed |

**Not loaded (legacy / debug):** `keyboard-debug.js`, `fatPoleTransformSpy.js`, `simulator.js`, `mainSimulator.js`, deleted GIS modules.

---

## 7. Estimated Performance Improvements

| Area | Estimate | Basis |
|------|----------|-------|
| Startup | **~5–15 ms** faster parse/init | Two debug scripts no longer loaded |
| Pan / zoom frame time | **~0.5–2 ms** saved per transform flush | FAT audit DOM/style queries skipped when `DEBUG=false` |
| Mousemove (crosshair active) | **~60–80% fewer** hit-tests | rAF coalescing vs raw mousemove frequency |
| Status bar pointermove | **~1 DOM lookup** saved per event | Cached `#status-bar-coords` |
| Console I/O | **~100% reduction** in production | 87 gated calls + 2 unloaded debug scripts |
| Fiber matrix regeneration | **Minor** when DEBUG off | 46 FiberDesignManager trace logs skipped |

Overall: smoother pan/zoom on maps with FAT poles; cleaner production console; lower main-thread work during pointer move. No user-visible behavior change expected.

---

## 8. Verification Checklist

- [ ] Load `simulator.html` — no console output except errors
- [ ] Pan and zoom — labels and nodes stay aligned
- [ ] Draw cable — double-click save still works (unchanged logic)
- [ ] Fiber matrix / splice UI — opens and renders correctly
- [ ] Set `window.FTTH_DEBUG = true` + reload — diagnostic logs return
- [ ] Re-add debug script tags temporarily — keyboard spy and transform audit work for dev

---

## 9. Re-enabling Debug Mode

**Option A — runtime (session only):**

```javascript
window.FTTH_DEBUG = true;
location.reload();
```

**Option B — HTML:**

```html
<script>window.FTTH_DEBUG = true;</script>
```

**Option C — restore spy scripts (dev only):**

```html
<script src="js/keyboard-debug.js"></script>
<script src="js/fatPoleTransformSpy.js"></script>
```

Place before `drawingEngine.js` in `simulator.html`.
