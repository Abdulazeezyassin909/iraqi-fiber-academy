# PROJECT ARCHITECTURE REPORT
## Engineer Path °360 FTTH Network Simulator

**Generated:** July 22, 2026
**Analysis Scope:** Complete JavaScript codebase, CSS, HTML structure
**Total Files Analyzed:** 40+ JavaScript files, 7 CSS files, 2 HTML files

---

## 1. FOLDER STRUCTURE

```
fiber_academy_platform/
├── css/                          (7 files)
│   ├── features.css              (1.8 KB) - Feature cards styling
│   ├── footer.css                (2.4 KB) - Footer component
│   ├── header.css                (3.9 KB) - Header/navigation
│   ├── hero.css                  (5.5 KB) - Hero section
│   ├── pricing.css               (2.6 KB) - Pricing cards
│   ├── simulator.css             (221 KB) - Main simulator styles (HUGE)
│   └── style.css                 (13 KB) - Global styles
├── icons/                        (0 items - empty)
├── images/                       (0 items - empty)
├── js/                           (43 items)
│   ├── _phase1_backup/           (1 file - backup)
│   │   └── ftth-simulator-core.post-phase1.js
│   ├── labels/                   (1 file)
│   │   └── LabelDataProviders.js
│   ├── settings/                 (1 file)
│   │   └── SimulatorSettings.js
│   ├── animations.js             (2.5 KB)
│   ├── cableEngine.js             (1.7 KB)
│   ├── designPersistence.js       (4.4 KB)
│   ├── drawingEngine.js           (173 KB) - CRITICAL: Very large
│   ├── equipmentManager.js       (6.5 KB)
│   ├── fatPoleTransformSpy.js     (9.4 KB) - DEBUG TOOL
│   ├── fiberMetrics.js            (7.2 KB)
│   ├── fileMenuBar.js            (14 KB)
│   ├── ftth-simulator-core.js     (458 KB) - CRITICAL: Massive monolith
│   ├── gisCableRouting.js         (7.5 KB)
│   ├── gisConnections.js          (3.3 KB)
│   ├── gisController.js          (8.8 KB)
│   ├── gisEquipmentTypes.js       (1.3 KB)
│   ├── gisIcons.js                (4 KB)
│   ├── gisMapRenderer.js          (7.6 KB)
│   ├── gisPlacement.js            (5.9 KB)
│   ├── gisProject.js              (2 KB)
│   ├── gisStore.js                (4.2 KB)
│   ├── gisTopology.js             (9 KB)
│   ├── keyboard-debug.js          (3.4 KB) - DEBUG TOOL
│   ├── LabelManager.js            (67 KB) - CRITICAL: Large label system
│   ├── main.js                    (2 KB) - Landing page only
│   ├── mainSimulator.js           (124 KB) - CRITICAL: Large orchestrator
│   ├── mapLayers.js               (3.3 KB)
│   ├── navigation.js              (2.3 KB) - Landing page only
│   ├── pathwayEditor.js           (71 KB) - CRITICAL: Large geometry editor
│   ├── projectSetupModal.js       (2.1 KB)
│   ├── propertyPanel.js           (9.6 KB)
│   ├── simContext.js              (2.8 KB) - Shared state
│   ├── simulator.js               (244 KB) - CRITICAL: Large bundle
│   ├── startupView.js             (6.4 KB)
│   ├── toolboxInventoryPanel.js   (21 KB)
│   ├── toolboxManager.js          (13 KB)
│   ├── uiController.js           (5.1 KB)
│   └── zoomPanManager.js          (7.9 KB)
├── index.html                    (27 KB) - Landing page
└── simulator.html                (45 KB) - Main simulator
```

---

## 2. JAVASCRIPT FILES - RESPONSIBILITIES

### CORE SIMULATOR (Monolithic)

**ftth-simulator-core.js (458 KB)**
- **Responsibility:** Massive monolith containing virtual city generation, FAT pole system, cable routing, settings, and core simulation state
- **Issues:** Too large, mixes concerns, should be split into modules
- **Key Functions:** City layout generation, FAT pole rendering, cable path management, settings persistence

**simulator.js (244 KB)**
- **Responsibility:** Unified bundle file (auto-generated via build-bundle.ps1)
- **Issues:** Contains duplicate state management with ftth-simulator-core.js
- **Key Functions:** Grid management, node/connection management, layout application

**mainSimulator.js (124 KB)**
- **Responsibility:** Main orchestrator for virtual city simulator
- **Issues:** Large, handles too many responsibilities
- **Key Functions:** City band grid generation, street mapping, layout creation

### LABEL SYSTEM

**LabelManager.js (67 KB)**
- **Responsibility:** Advanced label positioning, collision detection, zoom-responsive rendering
- **Issues:** Complex, handles both tool labels and cable labels, could be split
- **Key Functions:** Cable label placement, longitudinal spacing, perpendicular stacking, font scaling

**labels/LabelDataProviders.js (2.3 KB)**
- **Responsibility:** Read-only label data providers extracted from core
- **Status:** Good extraction, KEEP

### DRAWING & GEOMETRY

**drawingEngine.js (173 KB)**
- **Responsibility:** QField-style crosshair, pen rubber band, cut overlays, pixel-perfect rendering
- **Issues:** Extremely large, mixes drawing tools with rendering
- **Key Functions:** Snap-to-grid, cable magnetic snap, pen tool, vertex editing, cut tool

**pathwayEditor.js (71 KB)**
- **Responsibility:** Geometry operations, hit testing, split, curves, vertex editing
- **Issues:** Large, could be split into geometry vs. editing
- **Key Functions:** Distance calculations, path hit testing, vertex manipulation, split operations

### GIS SYSTEM (Leaflet-based)

**gisController.js (8.8 KB)**
- **Responsibility:** GIS system orchestrator - placement, topology, zones, cable routing
- **Status:** Well-structured, KEEP

**gisStore.js (4.2 KB)**
- **Responsibility:** GIS equipment & connection state management
- **Status:** Good separation, KEEP

**gisMapRenderer.js (7.6 KB)**
- **Responsibility:** Render GIS markers and fiber polylines on Leaflet map
- **Status:** Good separation, KEEP

**gisPlacement.js (5.9 KB)**
- **Responsibility:** GIS asset injection, zone/cable/topology mode delegation
- **Status:** Good separation, KEEP

**gisCableRouting.js (7.5 KB)**
- **Responsibility:** Dynamic GIS cable routing with click-to-angle vertices
- **Status:** Good separation, KEEP

**gisTopology.js (9 KB)**
- **Responsibility:** Field topology workflow - target points, route chaining
- **Status:** Good separation, KEEP

**gisConnections.js (3.3 KB)**
- **Responsibility:** GIS cable connections delegation
- **Status:** Good separation, KEEP

**gisEquipmentTypes.js (1.3 KB)**
- **Responsibility:** GIS equipment type definitions
- **Status:** Good separation, KEEP

**gisIcons.js (4 KB)**
- **Responsibility:** Custom Leaflet divIcon markers
- **Status:** Good separation, KEEP

**gisProject.js (2 KB)**
- **Responsibility:** GIS project metadata (Baghdad planning, compounds)
- **Status:** Good separation, KEEP

### UI & INTERACTION

**zoomPanManager.js (7.9 KB)**
- **Responsibility:** Zoom, pan, hand/select tools, zoom-responsive icon scaling
- **Status:** Good separation, KEEP

**equipmentManager.js (6.5 KB)**
- **Responsibility:** Equipment placement, drag/drop, context menu
- **Status:** Good separation, KEEP

**toolboxManager.js (13 KB)**
- **Responsibility:** Toolbox configuration manager - enable/disable entries
- **Status:** Good separation, KEEP

**toolboxInventoryPanel.js (21 KB)**
- **Responsibility:** Toolbox inventory panel with audit functionality
- **Status:** Good separation, KEEP

**uiController.js (5.1 KB)**
- **Responsibility:** Smart state manager - toolbox hover cursor, tool selection
- **Status:** Good separation, KEEP

**fileMenuBar.js (14 KB)**
- **Responsibility:** Application menu bar - File operations and project persistence
- **Status:** Good separation, KEEP

**propertyPanel.js (9.6 KB)**
- **Responsibility:** Node properties panel - extensible metadata display
- **Status:** Good separation, KEEP

**startupView.js (6.4 KB)**
- **Responsibility:** Startup/welcome screen - gatekeeper before workspace
- **Status:** Good separation, KEEP

**projectSetupModal.js (2.1 KB)**
- **Responsibility:** Project setup modal - training city selection
- **Status:** Good separation, KEEP

**VisibilityManager.js (5 KB)**
- **Responsibility:** Layer visibility manager - centralized toolbox-driven toggles
- **Status:** Good separation, KEEP

**PathwayPropertiesModal.js (24 KB)**
- **Responsibility:** Pathway properties modal - persistent bottom sheet
- **Status:** Good separation, KEEP

### UTILITIES

**fiberMetrics.js (7.2 KB)**
- **Responsibility:** Fiber geometry, distance, BOQ, loss-calculation prep
- **Status:** Good separation, KEEP

**designPersistence.js (4.4 KB)**
- **Responsibility:** LocalStorage save/load/auto-save for FTTH designs
- **Status:** Good separation, KEEP

**mapLayers.js (3.3 KB)**
- **Responsibility:** Map layer toggle logic (top toolbar)
- **Status:** Good separation, KEEP

**simContext.js (2.8 KB)**
- **Responsibility:** Shared simulator state - imported by all modules
- **Status:** Critical central state, KEEP

**settings/SimulatorSettings.js (1.8 KB)**
- **Responsibility:** Layout/label settings persistence extracted from core
- **Status:** Good extraction, KEEP

**cableEngine.js (1.7 KB)**
- **Responsibility:** Future cable routing stub (mostly placeholder)
- **Status:** STUB - minimal implementation

### LANDING PAGE (index.html only)

**main.js (2 KB)**
- **Responsibility:** Landing page interactions (FAQ, pricing, demo buttons)
- **Status:** Simple, KEEP

**navigation.js (2.3 KB)**
- **Responsibility:** Landing page navigation (mobile menu, scroll spy)
- **Status:** Simple, KEEP

**animations.js (2.5 KB)**
- **Responsibility:** Landing page animations (fade-in, counters)
- **Status:** Simple, KEEP

### DEBUG TOOLS

**fatPoleTransformSpy.js (9.4 KB)**
- **Responsibility:** Debug tool to catch transform writes on FAT pole icons
- **Status:** DEBUG TOOL - should be removed in production

**keyboard-debug.js (3.4 KB)**
- **Responsibility:** Keyboard event spy for debugging focus/fullscreen issues
- **Status:** DEBUG TOOL - should be removed in production

### BUILD SCRIPTS

**build-bundle.ps1 (2.3 KB)**
- **Responsibility:** Build script to bundle simulator.js
- **Status:** BUILD TOOL, KEEP

**merge-inline.ps1 (1.3 KB)**
- **Responsibility:** Build helper script
- **Status:** BUILD TOOL, KEEP

**reset-simulator-html.ps1 (1.2 KB)**
- **Responsibility:** Build helper script
- **Status:** BUILD TOOL, KEEP

---

## 3. DEPENDENCY GRAPH

### CENTRAL HUB: simContext.js
All ES6 modules import from `simContext.js` for shared state.

### GIS MODULE CLUSTER (Clean Architecture)
```
gisController (orchestrator)
├── gisStore (state)
├── gisMapRenderer (rendering)
├── gisPlacement (injection)
│   ├── gisEquipmentTypes
│   ├── gisStore
│   ├── gisTopology
│   └── gisCableRouting
├── gisTopology (workflow)
│   └── osmMapEngine (external dependency)
├── gisCableRouting (cable routing)
│   ├── gisStore
│   ├── gisMapRenderer
│   └── fiberMetrics
├── gisConnections (connections)
│   ├── gisStore
│   ├── gisCableRouting
│   └── fiberMetrics
└── gisIcons (markers)
    └── gisEquipmentTypes
```

### VIRTUAL CITY MODULE CLUSTER (Monolithic)
```
ftth-simulator-core.js (monolith)
├── Internal: city generation
├── Internal: FAT pole system
├── Internal: cable routing
├── Internal: settings
└── External: LabelManager (bridge injection)

mainSimulator.js
├── simContext
├── equipmentManager
├── zoomPanManager
└── Internal: layout generation

drawingEngine.js
├── Bridge injection from ftth-simulator-core
├── pathwayEditor (geometry)
└── Internal: rendering tools

pathwayEditor.js
├── Bridge injection
└── Internal: geometry operations
```

### LABEL SYSTEM CLUSTER
```
LabelManager.js
├── labels/LabelDataProviders (data)
├── Internal: collision detection
├── Internal: zoom-responsive rendering
└── Bridge injection from ftth-simulator-core
```

### UI CLUSTER (Well-Structured)
```
zoomPanManager
└── simContext

equipmentManager
├── simContext
└── zoomPanManager

toolboxManager
└── (standalone)

uiController
└── Bridge injection

fileMenuBar
└── Bridge injection

propertyPanel
├── simContext
├── fiberMetrics
├── gisEquipmentTypes
├── gisStore
└── fiberMetrics
```

### PERSISTENCE CLUSTER
```
designPersistence
├── simContext
└── mapLayers

fileMenuBar
└── (standalone localStorage)

settings/SimulatorSettings
└── Bridge injection
```

---

## 4. DUPLICATE CODE DETECTED

### CRITICAL DUPLICATES

**State Management Duplication:**
- `simContext.js` exports `ctx` object
- `simulator.js` defines its own `ctx` object (lines 12-85)
- `ftth-simulator-core.js` defines `Sim` object with overlapping state
- **Impact:** Conflicting state sources, potential sync issues

**Grid Configuration Duplication:**
- `simContext.js`: `GRID_CFG_STANDARD`, `GRID_CFG_SATELLITE`
- `simulator.js`: `GRID_CFG_STANDARD`, `GRID_CFG_SATELLITE` (lines 87-88)
- `mainSimulator.js`: `GRID_COLS`, `GRID_ROWS`, `CELL_SIZE` (lines 5-9)
- **Impact:** Multiple sources of truth for grid dimensions

**Zoom Constants Duplication:**
- `simContext.js`: `ZOOM_MIN: 0.08`, `ZOOM_MAX: 10`
- `simulator.js`: `ZOOM_MIN: 0.08`, `ZOOM_MAX: 2.5` (lines 34-35)
- **Impact:** Inconsistent zoom limits

**Placement Validation Duplication:**
- `simContext.js`: `SIDEWALK_EQUIPMENT`, `PLACEMENT_ERR_SIDEWALK`
- `equipmentManager.js`: imports same constants
- **Impact:** Redundant imports

### MEDIUM DUPLICATES

**Escape HTML Functions:**
- `LabelManager.js`: `escapeHtml()` function
- `propertyPanel.js`: `escapeHtml()` function
- `PathwayPropertiesModal.js`: `escapeHtml()` function
- **Impact:** Should be extracted to shared utility

**Distance Calculations:**
- `fiberMetrics.js`: `pixelDistance()`, `connectionLengthMeters()`
- `pathwayEditor.js`: `distToSegment()`, `distToSegmentSq()`
- **Impact:** Similar geometry math, could consolidate

**Format Functions:**
- `fiberMetrics.js`: `formatFiberLength()`
- Multiple files have similar formatting logic
- **Impact:** Minor duplication

---

## 5. DEAD CODE DETECTED

### UNUSED FILES

**_phase1_backup/ftth-simulator-core.post-phase1.js**
- **Status:** Backup file from Phase 1 refactoring
- **Recommendation:** REMOVE (backup should be in git, not in production)

### UNUSED FUNCTIONS

**cableEngine.js**
- `planRoute()` - Placeholder function with "future GIS / OSM integration" comment
- `createCableRoute()` - Created but never used
- **Recommendation:** Either implement or remove stub

**gisProject.js**
- `registerGisProject()` - Registers to ctx.api but may not be called
- **Recommendation:** Verify usage, potentially remove

### DEBUG CODE IN PRODUCTION

**fatPoleTransformSpy.js**
- Hooks CSSStyleDeclaration.prototype.transform setter
- Console logs every transform write
- **Recommendation:** REMOVE from production builds

**keyboard-debug.js**
- Logs all keyboard events
- Logs focus changes
- **Recommendation:** REMOVE from production builds

---

## 6. UNUSED FUNCTIONS

### POTENTIALLY UNUSED EXPORTS

**gisConnections.js**
- `disarmGisCableExport` - Re-export that may not be used
- `cancelCableDraw` - Re-export that may not be used

**fiberMetrics.js**
- `estimateSegmentLoss` - Referenced in cableEngine but cableEngine is stub
- **Recommendation:** Verify if loss calculation is actually used

**toolboxInventoryPanel.js**
- Multiple internal functions may not be called externally
- **Recommendation:** Audit public API

---

## 7. FILES NO LONGER USED

### BACKUP FILES

**js/_phase1_backup/ftth-simulator-core.post-phase1.js**
- **Status:** Backup from Phase 1 refactoring
- **Recommendation:** REMOVE (use git for version control)

### STUB FILES

**cableEngine.js**
- **Status:** Mostly placeholder/stub code
- **Recommendation:** Either implement full cable routing or REMOVE

---

## 8. OLD EXPERIMENTAL SYSTEMS

### DEBUG/EXPERIMENTAL

**fatPoleTransformSpy.js**
- **Purpose:** Debug tool for FAT pole transform issues
- **Status:** Experimental debugging code
- **Recommendation:** REMOVE after fixing transform issues

**keyboard-debug.js**
- **Purpose:** Debug keyboard/focus issues in fullscreen
- **Status:** Experimental debugging code
- **Recommendation:** REMOVE after fixing focus issues

### LEGACY BUNDLE SYSTEM

**simulator.js (244 KB)**
- **Status:** Auto-generated bundle from build-bundle.ps1
- **Issue:** Contains duplicate code with source files
- **Recommendation:** REFACTOR - consider ES module bundling instead

---

## 9. PERFORMANCE BOTTLENECKS

### ZOOM PERFORMANCE

**Critical Issues:**
1. **LabelManager.js** - Recalculates all label positions on every zoom change
   - Cable labels use complex parametric interpolation
   - Collision detection runs on every render
   - **Impact:** Lag during zoom operations with many labels

2. **zoomPanManager.js** - Applies transform to all nodes and lines
   - Loops through all `.placed-node` elements
   - Loops through all connection lines
   - **Impact:** O(n) DOM manipulation on every zoom

3. **drawingEngine.js** - Pixel-perfect rendering on every frame
   - `applyPixelPerfectCanvasContexts()` scans all canvases
   - **Impact:** Canvas context manipulation overhead

### PAN PERFORMANCE

**Critical Issues:**
1. **simulator.js** - Pan updates transform on canvas wrapper
   - No visible performance issues currently
   - **Impact:** Minimal

### RENDERING PERFORMANCE

**Critical Issues:**
1. **LabelManager.js** - Label rendering is heaviest operation
   - `renderLabels()` rebuilds entire HTML overlay
   - Cable label placement uses polyline walking
   - Collision detection runs for all labels
   - **Impact:** Major bottleneck with 50+ labels

2. **drawingEngine.js** - SVG manipulation for drawing tools
   - Updates SVG attributes on every mouse move
   - Rubber band rendering
   - **Impact:** Minor during drawing operations

3. **gisMapRenderer.js** - Leaflet marker updates
   - `refreshGisMarkerSelection()` updates marker icons
   - **Impact:** Minor with reasonable marker count

### LABEL RENDERING PERFORMANCE

**Critical Issues:**
1. **LabelManager.js** - Main bottleneck
   - `placeAbLmCabelTerminalLabel()` uses polyline walking
   - `pointAlongCableFromNode()` iterates through path segments
   - Collision detection checks against all placed labels
   - **Impact:** Severe with many cable labels

2. **Dynamic font scaling** - Font size recalculated on every zoom
   - `getCableLabelLod()` calculates scale factor
   - Applied via inline styles
   - **Impact:** Minor but accumulates

### CABLE RENDERING PERFORMANCE

**Critical Issues:**
1. **drawingEngine.js** - Cable stacking and magnetic snap
   - Cable magnetic snap radius calculations
   - Sequential cable stacking logic
   - **Impact:** Minor with reasonable cable count

2. **pathwayEditor.js** - Path hit testing
   - `hitTestPathsAll()` checks all path segments
   - Distance calculations for every segment
   - **Impact:** O(n*m) where n = paths, m = segments

---

## 10. MODULES NEEDING SPLIT

### CRITICAL: MUST SPLIT

**ftth-simulator-core.js (458 KB)**
- **Current State:** Massive monolith
- **Suggested Split:**
  - `CityGenerator.js` - City layout generation
  - `FatPoleSystem.js` - FAT pole rendering and logic
  - `CableRoutingCore.js` - Virtual city cable routing
  - `SimulatorSettings.js` - Settings management (already extracted)
  - `SimulatorState.js` - Core state management
- **Priority:** HIGH

**drawingEngine.js (173 KB)**
- **Current State:** Mixes drawing tools with rendering utilities
- **Suggested Split:**
  - `DrawingTools.js` - Pen, cut, vertex tools
  - `SnapSystem.js` - Magnetic snap, grid snap
  - `RenderingUtils.js` - Pixel-perfect rendering helpers
  - `CrosshairOverlay.js` - Crosshair rendering
- **Priority:** HIGH

**LabelManager.js (67 KB)**
- **Current State:** Handles both tool labels and cable labels
- **Suggested Split:**
  - `ToolLabelManager.js` - Tool/equipment labels
  - `CableLabelManager.js` - Cable badge labels
  - `LabelCollisionSystem.js` - Collision detection
  - `LabelPositioning.js` - Positioning algorithms
- **Priority:** MEDIUM

**mainSimulator.js (124 KB)**
- **Current State:** Large orchestrator
- **Suggested Split:**
  - `CityLayoutEngine.js` - Layout generation logic
  - `StreetMapper.js` - Street and sidewalk mapping
  - `GridManager.js` - Grid dimension management
- **Priority:** MEDIUM

**pathwayEditor.js (71 KB)**
- **Current State:** Mixes geometry with editing
- **Suggested Split:**
  - `GeometryUtils.js` - Distance, hit testing, math
  - `PathEditor.js` - Vertex editing, split operations
  - `PathGeometry.js` - Path manipulation
- **Priority:** MEDIUM

### MEDIUM PRIORITY

**simulator.js (244 KB)**
- **Current State:** Auto-generated bundle
- **Suggested Action:** Replace with ES module bundling (Vite/Rollup)
- **Priority:** MEDIUM

---

## 11. CIRCULAR DEPENDENCIES

### DETECTED CIRCULAR DEPENDENCIES

**GIS System - Mild Circular Reference:**
```
gisController → gisPlacement → gisCableRouting → gisMapRenderer → gisStore
gisController also imports from gisMapRenderer
```
- **Impact:** Minimal, mostly orchestrator pattern
- **Recommendation:** Acceptable for orchestrator pattern

**Label System - Bridge Injection:**
```
LabelManager → (bridge injection) → ftth-simulator-core
ftth-simulator-core → (bridge injection) → LabelManager
```
- **Impact:** Bridge pattern creates circular dependency
- **Recommendation:** Refactor to proper ES module imports

**Drawing System - Bridge Injection:**
```
drawingEngine → (bridge injection) → ftth-simulator-core
ftth-simulator-core → (bridge injection) → drawingEngine
```
- **Impact:** Bridge pattern creates circular dependency
- **Recommendation:** Refactor to proper ES module imports

---

## 12. GLOBAL VARIABLES THAT SHOULD BECOME MODULES

### CRITICAL GLOBALS

**Window Globals (ftth-simulator-core.js):**
- `window.Sim` - Core simulator state object
- `window.FTTHDrawingEngine` - Drawing engine API
- `window.FTTHFileMenu` - File menu API
- `window.FTTHProjectSetupModal` - Project setup modal API
- `window.FTTHVisibilityManager` - Visibility manager API
- `window.FTTHToolboxInventoryPanel` - Toolbox inventory API
- **Recommendation:** Convert to ES module exports

**Window Globals (Debug Tools):**
- `window.__FTTH_POLE_TRANSFORM_SPY__` - Debug flag
- `window.__FTTH_KEYBOARD_DEBUG__` - Debug flag
- **Recommendation:** Remove or make configurable via build flags

### MEDIUM PRIORITY GLOBALS

**Legacy Globals (simulator.js):**
- `ctx` - Shared state object (should use simContext.js import)
- `GRID_CFG_STANDARD`, `GRID_CFG_SATELLITE` - Should be in simContext.js
- **Recommendation:** Consolidate into simContext.js

---

## 13. SAFE CLEANUP PLAN

### KEEP (Production-Ready, Well-Structured)

**GIS System (Excellent Architecture):**
- gisController.js - KEEP
- gisStore.js - KEEP
- gisMapRenderer.js - KEEP
- gisPlacement.js - KEEP
- gisCableRouting.js - KEEP
- gisTopology.js - KEEP
- gisConnections.js - KEEP
- gisEquipmentTypes.js - KEEP
- gisIcons.js - KEEP
- gisProject.js - KEEP

**UI System (Well-Separated):**
- zoomPanManager.js - KEEP
- equipmentManager.js - KEEP
- toolboxManager.js - KEEP
- toolboxInventoryPanel.js - KEEP
- uiController.js - KEEP
- fileMenuBar.js - KEEP
- propertyPanel.js - KEEP
- startupView.js - KEEP
- projectSetupModal.js - KEEP
- VisibilityManager.js - KEEP
- PathwayPropertiesModal.js - KEEP

**Utilities (Good Separation):**
- fiberMetrics.js - KEEP
- designPersistence.js - KEEP
- mapLayers.js - KEEP
- simContext.js - KEEP
- settings/SimulatorSettings.js - KEEP
- labels/LabelDataProviders.js - KEEP

**Landing Page (Simple, Clean):**
- main.js - KEEP
- navigation.js - KEEP
- animations.js - KEEP

**Build Tools:**
- build-bundle.ps1 - KEEP
- merge-inline.ps1 - KEEP
- reset-simulator-html.ps1 - KEEP

### REFACTOR (Split Large Modules)

**CRITICAL - High Priority:**
- ftth-simulator-core.js - REFACTOR (split into 5+ modules)
- drawingEngine.js - REFACTOR (split into 4 modules)

**MEDIUM Priority:**
- LabelManager.js - REFACTOR (split into 4 modules)
- mainSimulator.js - REFACTOR (split into 3 modules)
- pathwayEditor.js - REFACTOR (split into 3 modules)
- simulator.js - REFACTOR (replace with ES module bundling)

### MERGE (Consolidate Duplicates)

**State Management:**
- Merge simulator.js `ctx` into simContext.js
- Remove duplicate grid constants from simulator.js
- Remove duplicate zoom constants from simulator.js

**Utility Functions:**
- Extract `escapeHtml()` to shared utils module
- Consolidate distance calculations into geometry utils

### REMOVE (Dead/Debug Code)

**Debug Tools:**
- fatPoleTransformSpy.js - REMOVE (production)
- keyboard-debug.js - REMOVE (production)

**Backup Files:**
- _phase1_backup/ftth-simulator-core.post-phase1.js - REMOVE

**Stub Code:**
- cableEngine.js - REMOVE or IMPLEMENT (currently stub)

**Unused Exports:**
- Review and remove unused re-exports in gisConnections.js

---

## 14. SUMMARY STATISTICS

### File Size Analysis
- **Largest Files:**
  1. ftth-simulator-core.js: 458 KB (CRITICAL)
  2. simulator.js: 244 KB (CRITICAL)
  3. drawingEngine.js: 173 KB (CRITICAL)
  4. mainSimulator.js: 124 KB (HIGH)
  5. LabelManager.js: 67 KB (MEDIUM)
  6. pathwayEditor.js: 71 KB (MEDIUM)

- **Total JavaScript Size:** ~1.5 MB (unminified)

### Architecture Quality Score
- **GIS System:** 9/10 (Excellent modular design)
- **UI System:** 8/10 (Good separation)
- **Virtual City System:** 3/10 (Monolithic, needs refactoring)
- **Label System:** 5/10 (Functional but large)
- **Overall:** 6/10 (Mixed quality)

### Technical Debt Summary
- **Critical Issues:** 5 (monoliths, duplicate state, circular dependencies)
- **High Priority:** 3 (large modules needing split)
- **Medium Priority:** 4 (duplicates, unused code)
- **Low Priority:** 2 (debug tools, stub code)

### Recommended Action Plan
1. **Phase 1 (Immediate):** Remove debug tools and backup files
2. **Phase 2 (Short-term):** Split ftth-simulator-core.js into modules
3. **Phase 3 (Medium-term):** Split drawingEngine.js and LabelManager.js
4. **Phase 4 (Long-term):** Migrate from global window objects to ES modules
5. **Phase 5 (Maintenance):** Consolidate duplicate utilities and constants

---

**END OF REPORT**
