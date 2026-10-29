/**
 * Image-to-Grid workflow — upload a hand-drawn map as simulator background
 * with a transparent graph-paper grid overlay (2D canvas coordinates, no EPSG).
 */
(function (global) {
  'use strict';

  var UPLOADED_MAP_ID = 'uploaded_map';
  var DEFAULT_CELL_SIZE = 24;
  var MIN_GRID_DIM = 12;

  function getSim() {
    return global.FTTHSim;
  }

  function isImageMapActive() {
    var Sim = getSim();
    return Sim && Sim.coordinateMode === 'canvas2d' && Sim.activeCityId === UPLOADED_MAP_ID;
  }

  function makeCanvasCells(cols, rows) {
    var cells = new Array(cols * rows);
    for (var i = 0; i < cells.length; i++) {
      cells[i] = { type: 'canvas', label: '' };
    }
    return cells;
  }

  function computeLayoutFromImage(img, wrapper) {
    var maxW = Math.max(480, (wrapper && wrapper.clientWidth) ? wrapper.clientWidth - 40 : 960);
    var maxH = Math.max(360, (wrapper && wrapper.clientHeight) ? wrapper.clientHeight - 40 : 640);
    var cellSize = DEFAULT_CELL_SIZE;
    var imgW = img.naturalWidth || img.width || 1;
    var imgH = img.naturalHeight || img.height || 1;
    var imgAspect = imgW / imgH;

    var cols = Math.max(MIN_GRID_DIM, Math.floor(maxW / cellSize));
    var rows = Math.max(MIN_GRID_DIM, Math.floor(maxH / cellSize));
    var gridAspect = cols / rows;

    if (gridAspect > imgAspect) {
      cols = Math.max(MIN_GRID_DIM, Math.round(rows * imgAspect));
    } else {
      rows = Math.max(MIN_GRID_DIM, Math.round(cols / imgAspect));
    }

    return {
      cfg: { id: UPLOADED_MAP_ID, cols: cols, rows: rows, cellSize: cellSize, fdtCapacity: 4 },
      cols: cols,
      rows: rows,
      cellSize: cellSize,
      cells: makeCanvasCells(cols, rows),
      imageWidth: imgW,
      imageHeight: imgH,
    };
  }

  function getCityCanvas() {
    return document.getElementById('city-canvas');
  }

  function getSatelliteLayer() {
    return document.getElementById('satellite-bg-layer');
  }

  function getGridOverlayCanvas() {
    return document.getElementById('image-map-grid-overlay');
  }

  function getStreetLayer() {
    return document.getElementById('street-layer');
  }

  function applyBackgroundImage(dataUrl) {
    var sat = getSatelliteLayer();
    var canvas = getCityCanvas();
    if (!sat) return;
    if (dataUrl) {
      sat.style.backgroundImage = 'url("' + String(dataUrl).replace(/"/g, '\\"') + '")';
      sat.style.backgroundSize = 'contain';
      sat.style.backgroundPosition = 'center center';
      sat.style.backgroundRepeat = 'no-repeat';
    } else {
      sat.style.backgroundImage = '';
      sat.style.backgroundSize = '';
      sat.style.backgroundPosition = '';
    }
    if (canvas) {
      canvas.classList.add('map-canvas--image-map');
      canvas.setAttribute('data-coordinate-mode', 'canvas2d');
    }
    var street = getStreetLayer();
    if (street) street.style.display = 'none';
  }

  function clearBackgroundImage() {
    var sat = getSatelliteLayer();
    var canvas = getCityCanvas();
    if (sat) {
      sat.style.backgroundImage = '';
      sat.style.backgroundSize = '';
      sat.style.backgroundPosition = '';
    }
    if (canvas) {
      canvas.classList.remove('map-canvas--image-map');
      canvas.removeAttribute('data-coordinate-mode');
    }
    var street = getStreetLayer();
    if (street) street.style.display = '';
    hideGridOverlay();
  }

  function drawGridOverlay() {
    var overlay = getGridOverlayCanvas();
    var Sim = getSim();
    if (!overlay || !Sim || !Sim.layout || !isImageMapActive()) {
      hideGridOverlay();
      return;
    }

    var cs = Sim.layout.cellSize || DEFAULT_CELL_SIZE;
    var w = Sim.layout.cols * cs;
    var h = Sim.layout.rows * cs;

    overlay.width = w;
    overlay.height = h;
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    overlay.style.display = 'block';
    overlay.removeAttribute('aria-hidden');

    var ctx = overlay.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 1;

    for (var x = 0; x <= w; x += cs) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    for (var y = 0; y <= h; y += cs) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function hideGridOverlay() {
    var overlay = getGridOverlayCanvas();
    if (!overlay) return;
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
    var ctx = overlay.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, overlay.width, overlay.height);
  }

  function configureSimForImageMap(layout, dataUrl) {
    var Sim = getSim();
    if (!Sim) return false;

    Sim.coordinateMode = 'canvas2d';
    Sim.activeCityId = UPLOADED_MAP_ID;
    Sim.uploadedMapLayout = layout;
    Sim.uploadedMapImage = dataUrl || null;

    var sel = document.getElementById('layout-select');
    if (sel) sel.value = UPLOADED_MAP_ID;

    applyBackgroundImage(dataUrl);
    return true;
  }

  function resetImageMapState() {
    var Sim = getSim();
    if (!Sim) return;
    if (Sim.coordinateMode === 'canvas2d') {
      Sim.coordinateMode = 'geographic';
    }
    Sim.uploadedMapLayout = null;
    Sim.uploadedMapImage = null;
    if (Sim.activeCityId === UPLOADED_MAP_ID) {
      Sim.activeCityId = 'training_city_1';
    }
    clearBackgroundImage();
  }

  function beginImageMapProject(dataUrl, img) {
    global.FTTHSimBoot?.run?.();

    var wrapper = document.getElementById('canvas-wrapper');
    var layout = computeLayoutFromImage(img, wrapper);
    configureSimForImageMap(layout, dataUrl);

    var ok = global.FTTHFileMenu?.createNewEmptyProject?.();
    if (ok === false) return false;

    var Sim = getSim();
    if (Sim) {
      Sim.activeCityId = UPLOADED_MAP_ID;
      Sim.uploadedMapLayout = layout;
      Sim.uploadedMapImage = dataUrl;
      Sim.coordinateMode = 'canvas2d';
    }

    global.FTTHStartupView?.setProjectLoaded?.(true, { skipSetupModal: true });

    requestAnimationFrame(function () {
      applyBackgroundImage(dataUrl);
      drawGridOverlay();
      if (Sim?.scheduleInitialMapCenter) {
        Sim.scheduleInitialMapCenter({ force: true });
      }
    });

    return true;
  }

  function loadImageFromFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      alert('Please choose a valid image file (PNG, JPG, GIF, or WebP).');
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = reader.result;
      var img = new Image();
      img.onload = function () {
        beginImageMapProject(dataUrl, img);
      };
      img.onerror = function () {
        alert('Could not read the image file.');
      };
      img.src = dataUrl;
    };
    reader.onerror = function () {
      alert('Failed to load the image file.');
    };
    reader.readAsDataURL(file);
  }

  function openImageFilePicker() {
    var input = document.getElementById('startup-map-upload-input');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'startup-map-upload-input';
      input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp';
      input.style.display = 'none';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        input.value = '';
        if (file) loadImageFromFile(file);
      });
      document.body.appendChild(input);
    }
    input.click();
  }

  function restoreFromProject(payload) {
    if (!payload || payload.coordinateMode !== 'canvas2d' || payload.layout !== UPLOADED_MAP_ID) {
      if (!isImageMapActive()) resetImageMapState();
      return;
    }

    var Sim = getSim();
    if (!Sim) return;

    Sim.coordinateMode = 'canvas2d';
    Sim.activeCityId = UPLOADED_MAP_ID;
    Sim.uploadedMapImage = payload.uploadedMapImage || null;

    if (payload.uploadedMapMeta) {
      var meta = payload.uploadedMapMeta;
      Sim.uploadedMapLayout = {
        cfg: { id: UPLOADED_MAP_ID, cols: meta.cols, rows: meta.rows, cellSize: meta.cellSize, fdtCapacity: 4 },
        cols: meta.cols,
        rows: meta.rows,
        cellSize: meta.cellSize,
        cells: makeCanvasCells(meta.cols, meta.rows),
        imageWidth: meta.imageWidth || 0,
        imageHeight: meta.imageHeight || 0,
      };
    }

    applyBackgroundImage(Sim.uploadedMapImage);
    requestAnimationFrame(drawGridOverlay);
  }

  function onCityRendered() {
    if (!isImageMapActive()) return;
    applyBackgroundImage(getSim()?.uploadedMapImage);
    drawGridOverlay();
  }

  function onWorkspaceCleared() {
    if (getSim()?.activeCityId !== UPLOADED_MAP_ID) {
      resetImageMapState();
    }
  }

  function extendSerialize(payload) {
    if (!payload || !isImageMapActive()) return payload;
    var Sim = getSim();
    payload.coordinateMode = 'canvas2d';
    payload.uploadedMapImage = Sim.uploadedMapImage || null;
    if (Sim.uploadedMapLayout) {
      payload.uploadedMapMeta = {
        cols: Sim.uploadedMapLayout.cols,
        rows: Sim.uploadedMapLayout.rows,
        cellSize: Sim.uploadedMapLayout.cellSize,
        imageWidth: Sim.uploadedMapLayout.imageWidth || 0,
        imageHeight: Sim.uploadedMapLayout.imageHeight || 0,
      };
    }
    return payload;
  }

  global.FTTHImageMapProject = {
    UPLOADED_MAP_ID: UPLOADED_MAP_ID,
    isActive: isImageMapActive,
    openImageFilePicker: openImageFilePicker,
    beginImageMapProject: beginImageMapProject,
    restoreFromProject: restoreFromProject,
    onCityRendered: onCityRendered,
    onWorkspaceCleared: onWorkspaceCleared,
    extendSerialize: extendSerialize,
    drawGridOverlay: drawGridOverlay,
    resetImageMapState: resetImageMapState,
    computeLayoutFromImage: computeLayoutFromImage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
