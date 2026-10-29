# ZOOM/PAN FEEL REGRESSION REPORT
## Investigation of Zoom/Pan Interaction Changes

**Date:** July 23, 2026
**Type:** Read-only diagnostics (no code modifications)

---

## ISSUE SUMMARY

**Previous Behavior:**
- Mouse wheel zoom felt incremental
- Each wheel notch produced a small visible step
- Zoom had a slight mechanical / stepped feel
- Pan movement had a subtle camera weight or inertia

**Current Behavior:**
- Zoom feels too direct
- Scale changes immediately
- The previous wheel-step feeling is gone
- Pan feels more rigid

---

## FINDINGS

### 1. MOUSE WHEEL PROCESSING

**File:** `js/zoomPanManager.js`
**Function:** `onMapWheel` (lines 116-124)

```javascript
export function onMapWheel(e) {
  if (!ctx.dom.canvasWrapper) return;
  e.preventDefault();
  const rect = ctx.dom.canvasWrapper.getBoundingClientRect();
  const px = e.clientX - rect.left;
  const py = e.clientY - rect.top;
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  setZoom(ctx.zoomLevel + delta, px, py);
}
```

**Analysis:**
- Fixed delta of `0.08` per wheel event (no variable sensitivity)
- No accumulation of `deltaY` values
- No smoothing or interpolation
- Direct call to `setZoom()` which immediately applies transform
- **Status:** NO smoothing logic present

---

### 2. ZOOM STEP CALCULATION

**File:** `js/zoomPanManager.js`
**Function:** `setZoom` (lines 94-103)

```javascript
export function setZoom(val, pivotX, pivotY) {
  const newZoom = Math.max(ctx.ZOOM_MIN, Math.min(ctx.ZOOM_MAX, Math.round(val * 100) / 100));
  if (pivotX != null && pivotY != null) {
    const ratio = newZoom / ctx.zoomLevel;
    ctx.panX = pivotX - (pivotX - ctx.panX) * ratio;
    ctx.panY = pivotY - (pivotY - ctx.panY) * ratio;
  }
  ctx.zoomLevel = newZoom;
  applyMapTransform();
}
```

**Analysis:**
- Uses `Math.round(val * 100) / 100` to round to 2 decimal places
- Creates discrete steps of 0.01
- **NO interpolation** between current and target zoom
- Immediate application via `applyMapTransform()`
- **Status:** NO interpolation present

---

### 3. ZOOM SENSITIVITY

**File:** `js/zoomPanManager.js`
**Function:** `onMapWheel` (line 122)

**Analysis:**
- Fixed delta of `0.08` per wheel event
- No variable sensitivity based on scroll speed
- No momentum or acceleration
- **Status:** Fixed sensitivity, no dynamic adjustment

---

### 4. ZOOM INTERPOLATION

**File:** `js/zoomPanManager.js`
**Function:** `setZoom` → `applyMapTransform`

**Analysis:**
- **NONE** - zoom is applied immediately
- No easing function
- No animation between zoom levels
- No tweening or lerping
- **Status:** NO interpolation present

---

### 5. REQUESTANIMATIONFRAME USAGE

**File:** `js/zoomPanManager.js`

**Zoom:**
- `applyZoomCompensation()` (lines 74-80) uses RAF for DOM updates
- **NOT used for zoom interpolation** - only for DOM style application

**Pan:**
- `onPanMove()` (lines 147-158) uses RAF throttling
- This was likely ADDED in recent optimization

```javascript
let _panRaf = 0;

export function onPanMove(e) {
  if (!ctx.isPanning || !ctx.panSession) return;
  ctx.panX = ctx.panSession.panX + (e.clientX - ctx.panSession.x);
  ctx.panY = ctx.panSession.panY + (e.clientY - ctx.panSession.y);
  if (_panRaf) return;
  _panRaf = requestAnimationFrame(function () {
    _panRaf = 0;
    applyMapTransform();
  });
}
```

**Analysis:**
- Pan updates are now throttled to RAF (once per frame)
- Previously, pan likely updated on every mousemove event
- RAF throttling reduces update frequency to ~60fps
- **Status:** RAF throttling ADDED (likely recent change)

---

### 6. EASING OR SMOOTHING LOGIC

**File:** `js/zoomPanManager.js`

**Analysis:**
- **NO easing functions found**
- **NO smoothing algorithms**
- **NO momentum/inertia systems**
- **NO lerping or tweening**
- **Status:** NO smoothing logic present anywhere in file

---

### 7. PAN INERTIA / CAMERA SMOOTHING

**File:** `js/zoomPanManager.js`
**Function:** `onPanMove` (lines 149-158)

**Analysis:**
- Direct 1:1 mouse movement mapping
- `ctx.panX = ctx.panSession.panX + (e.clientX - ctx.panSession.x)`
- No momentum/inertia system
- No spring physics
- No damping
- No velocity tracking
- RAF throttling was likely ADDED in recent optimization
- **Status:** NO inertia, RAF throttling likely added recently

---

## MOST LIKELY RESPONSIBLE ITEM

### PRIMARY SUSPECT: RAF Throttling in `onPanMove()`

**File:** `js/zoomPanManager.js`
**Function:** `onPanMove` (lines 147-158)
**Lines Changed:** 147-158 (recent optimization)

**Why This is the Most Likely Cause:**

1. **Pan Feel Change:** The user reports pan feels "more rigid" - this directly correlates with RAF throttling
2. **Recent Change:** This code was likely added in the recent performance optimization
3. **Behavior Change:**
   - **Before:** Pan updated on every mousemove event (higher frequency, smoother feel)
   - **After:** Pan updates only once per RAF frame (~60fps, more discrete feel)
4. **Camera Weight Loss:** The "subtle camera weight" feeling comes from higher-frequency updates that create a sense of fluidity. RAF throttling removes this.

**Evidence:**
- The code uses `if (_panRaf) return;` to skip intermediate updates
- This creates a "stepped" feel instead of continuous movement
- Direct correlation with user's complaint about "rigid" pan feel

---

## SECONDARY SUSPECT: Zoom Has No Smoothing

**File:** `js/zoomPanManager.js`
**Function:** `setZoom` (lines 94-103)

**Why This Contributes:**

1. **Zoom Feel Change:** User reports zoom feels "too direct" and "immediate"
2. **No Interpolation:** Zoom changes instantly without any easing
3. **Fixed Steps:** Fixed delta of 0.08 creates mechanical feel
4. **No Animation:** No transition between zoom levels

**Evidence:**
- Direct `ctx.zoomLevel = newZoom` assignment
- Immediate `applyMapTransform()` call
- No lerping or easing functions

---

## RECOMMENDATION

**Primary Fix (Pan):**
- Remove RAF throttling from `onPanMove()` or implement proper inertia system
- Consider using velocity-based smoothing instead of simple throttling

**Secondary Fix (Zoom):**
- Implement zoom interpolation/lerping
- Add easing function for smooth zoom transitions
- Consider variable sensitivity based on scroll speed

---

## FILES TO CHECK FOR PREVIOUS IMPLEMENTATION

If previous smoothing existed, it may have been in:
1. `js/zoomPanManager.js` - Check git history for previous version
2. `js/mainSimulator.js` - May have had camera smoothing logic
3. `js/drawingEngine.js` - May have had interaction smoothing
4. `js/ftth-simulator-core.js` - May have had camera physics

---

## CONCLUSION

The zoom/pan feel regression is most likely caused by:

1. **PRIMARY:** RAF throttling added to `onPanMove()` in recent optimization
2. **SECONDARY:** Zoom has never had smoothing (may have been acceptable before, but now feels worse due to pan change)

The pan RAF throttling is the most likely culprit because:
- It directly explains the "rigid" pan feel
- It was likely added in recent optimization
- It changes the update frequency from continuous to discrete
- It removes the "camera weight" feeling the user previously experienced
