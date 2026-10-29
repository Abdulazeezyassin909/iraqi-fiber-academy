/**
 * Simulator icons / showcase images — client-side Canvas resize + WebP/JPEG compression.
 * Compressed data URIs are stored directly in Firestore (no Firebase Storage).
 */

export const MAX_ICON_KB = 28;
export const ICON_TARGET_KB = 22;
export const ICON_MAX_PX = 256;
export const ICON_FALLBACK_MAX_PX = 300;
export const ICON_QUALITY = 0.88;
export const SHOWCASE_MAX_WIDTH_PX = 400;
export const SHOWCASE_MAX_KB = 72;
export const SHOWCASE_QUALITY = 0.5;
export const MAX_FIRESTORE_PAYLOAD_BYTES = 768000;

export function rejectDataUrl(url) {
  return /^data:/i.test(String(url == null ? '' : url).trim());
}

function isSvgFile(file) {
  var type = String((file && file.type) || '').toLowerCase();
  var name = String((file && file.name) || '').toLowerCase();
  return type.indexOf('svg') !== -1 || name.endsWith('.svg');
}

function isDataUrlSvg(dataUrl) {
  return /^data:image\/svg\+xml/i.test(String(dataUrl || '').trim());
}

function isEphemeralPreviewUrl(value) {
  return String(value || '').trim().indexOf('blob:') === 0;
}

function isCloudStorageUrl(value) {
  return String(value || '').trim().indexOf('https://firebasestorage.googleapis.com') === 0;
}

function isIconImageSrc(value) {
  var str = String(value || '').trim();
  return (
    /^https?:\/\//i.test(str) ||
    str.indexOf('firebasestorage.googleapis.com') !== -1 ||
    rejectDataUrl(str)
  );
}

export function dataUrlByteLength(dataUrl) {
  var base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.ceil((base64.length * 3) / 4);
}

export function dataUrlSizeKb(dataUrl) {
  return dataUrlByteLength(dataUrl) / 1024;
}

function logCompressedSize(fileName, dataUrl) {
  var kbSize = dataUrlSizeKb(dataUrl);
  console.log(`[CMS Media] Compressed ${fileName}: ${kbSize.toFixed(2)} KB`);
  return kbSize;
}

function loadFileOnCanvas(file, maxWidth, maxHeight) {
  return new Promise(function (resolve, reject) {
    if (!file) {
      reject(new Error('لم يتم اختيار ملف.'));
      return;
    }

    var objectUrl = URL.createObjectURL(file);
    var img = new Image();

    img.onload = function () {
      URL.revokeObjectURL(objectUrl);
      var w = img.naturalWidth || img.width || 1;
      var h = img.naturalHeight || img.height || 1;
      var scale = Math.min(1, maxWidth / w, maxHeight / h);
      var cw = Math.max(1, Math.round(w * scale));
      var ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw;
      canvas.height = ch;
      var ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('تعذّر تهيئة Canvas لضغط الصورة.'));
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, cw, ch);
      resolve({ canvas: canvas, fileName: file.name || 'image' });
    };

    img.onerror = function () {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('تعذّر قراءة الصورة «' + (file.name || 'image') + '».'));
    };

    img.src = objectUrl;
  });
}

function canvasToDataUrl(canvas, quality) {
  var q = typeof quality === 'number' ? quality : ICON_QUALITY;
  try {
    var webp = canvas.toDataURL('image/webp', q);
    if (webp && webp.indexOf('data:image/webp') === 0) {
      return webp;
    }
  } catch (err) {
    console.warn('[CMS Media] WebP toDataURL failed, falling back to JPEG', err);
  }
  return canvas.toDataURL('image/jpeg', q);
}

/**
 * Resize + compress a raster image to a data URI (WebP preferred, JPEG fallback).
 */
export async function compressImageFile(file, maxWidth, maxHeight, quality) {
  if (!file) {
    throw new Error('لم يتم اختيار ملف للضغط.');
  }

  if (isSvgFile(file)) {
    var svgText = await file.text();
    var encoded = encodeURIComponent(svgText).replace(/'/g, '%27').replace(/"/g, '%22');
    var svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encoded;
    logCompressedSize(file.name || 'icon.svg', svgDataUrl);
    return svgDataUrl;
  }

  var q = typeof quality === 'number' ? quality : ICON_QUALITY;
  var loaded = await loadFileOnCanvas(file, maxWidth, maxHeight);
  var dataUrl = canvasToDataUrl(loaded.canvas, q);
  logCompressedSize(loaded.fileName, dataUrl);
  return dataUrl;
}

/**
 * HD icon compression for Firestore (256px @ 0.88 — target ~15–25 KB each).
 */
export async function compressIconForFirestore(file) {
  var qualities = [ICON_QUALITY, 0.84, 0.8, 0.76, 0.72];
  var sizes = [
    { w: ICON_MAX_PX, h: ICON_MAX_PX },
    { w: ICON_FALLBACK_MAX_PX, h: ICON_FALLBACK_MAX_PX },
    { w: 224, h: 224 },
    { w: 192, h: 192 },
  ];

  var lastDataUrl = '';
  var lastKb = Infinity;

  for (var s = 0; s < sizes.length; s++) {
    for (var q = 0; q < qualities.length; q++) {
      var dataUrl = await compressImageFile(file, sizes[s].w, sizes[s].h, qualities[q]);
      var kbSize = dataUrlSizeKb(dataUrl);
      lastDataUrl = dataUrl;
      lastKb = kbSize;
      if (kbSize <= MAX_ICON_KB) {
        return dataUrl;
      }
    }
  }

  if (lastDataUrl && lastKb <= MAX_ICON_KB * 1.15) {
    console.warn(
      '[CMS Media] Icon slightly above target but keeping HD quality:',
      lastKb.toFixed(2),
      'KB'
    );
    return lastDataUrl;
  }

  throw new Error(
    'تعذّر ضغط الأيقونة «' +
      (file.name || 'image') +
      '» إلى أقل من ' +
      MAX_ICON_KB +
      ' كيلوبايت (الحجم الحالي: ' +
      lastKb.toFixed(2) +
      ' KB).'
  );
}

/**
 * Aggressive showcase compression (400px max width, quality 0.5).
 */
export async function compressShowcaseForFirestore(file) {
  var qualities = [SHOWCASE_QUALITY, 0.42, 0.35, 0.28];
  var widths = [SHOWCASE_MAX_WIDTH_PX, 360, 320];

  var lastDataUrl = '';
  var lastKb = Infinity;

  for (var w = 0; w < widths.length; w++) {
    for (var q = 0; q < qualities.length; q++) {
      var dataUrl = await compressImageFile(file, widths[w], 1200, qualities[q]);
      lastDataUrl = dataUrl;
      lastKb = dataUrlSizeKb(dataUrl);
      if (lastKb <= SHOWCASE_MAX_KB) {
        return dataUrl;
      }
    }
  }

  if (lastDataUrl && lastKb <= SHOWCASE_MAX_KB * 1.5) {
    return lastDataUrl;
  }

  console.warn('[CMS Media] Showcase image still large after compression, clearing:', lastKb.toFixed(2), 'KB');
  return '';
}

export async function dataUrlToFile(dataUrl, filename) {
  var src = String(dataUrl || '').trim();
  if (!rejectDataUrl(src)) {
    throw new Error('قيمة الصورة ليست data URL');
  }
  var response = await fetch(src);
  var blob = await response.blob();
  var name = filename || 'image.webp';
  return new File([blob], name, { type: blob.type || 'image/webp' });
}

function shouldResolveSimulatorIcon(entry) {
  if (!entry || !entry.icon) return false;
  if (entry.iconType === 'image') return true;
  if (isIconImageSrc(entry.icon)) return true;
  return rejectDataUrl(entry.icon);
}

async function resolveSimulatorIconValue(simId, value, pendingFile) {
  if (pendingFile) {
    return compressIconForFirestore(pendingFile);
  }

  var str = String(value || '').trim();
  if (!str) return '';

  if (isCloudStorageUrl(str)) {
    return str;
  }

  if (isEphemeralPreviewUrl(str)) {
    throw new Error('أعد رفع أيقونة المحاكي «' + simId + '» قبل النشر.');
  }

  if (rejectDataUrl(str)) {
    if (isDataUrlSvg(str)) {
      return str;
    }
    if (dataUrlSizeKb(str) <= MAX_ICON_KB) {
      return str;
    }
    var rasterFile = await dataUrlToFile(str, simId + '-icon.webp');
    return compressIconForFirestore(rasterFile);
  }

  return str;
}

async function resolveShowcaseImageValue(simId, value, pendingFile) {
  if (pendingFile) {
    return compressShowcaseForFirestore(pendingFile);
  }

  var str = String(value || '').trim();
  if (!str) return '';

  if (isCloudStorageUrl(str)) {
    return str;
  }

  if (isEphemeralPreviewUrl(str)) {
    throw new Error('أعد رفع صورة عرض المحاكي «' + simId + '» قبل النشر.');
  }

  if (rejectDataUrl(str)) {
    if (isDataUrlSvg(str)) {
      return str;
    }
    if (dataUrlSizeKb(str) <= SHOWCASE_MAX_KB) {
      return str;
    }
    try {
      var rasterFile = await dataUrlToFile(str, simId + '-showcase.webp');
      return compressShowcaseForFirestore(rasterFile);
    } catch (err) {
      console.warn('[CMS Media] Failed to recompress showcase for', simId, err);
      return '';
    }
  }

  return str;
}

function catalogIdsFromPayload(payload) {
  if (window.PlatformSimulators && Array.isArray(window.PlatformSimulators.CATALOG)) {
    return window.PlatformSimulators.CATALOG.map(function (s) {
      return String(s.id || '');
    }).filter(Boolean);
  }
  var ids = {};
  var meta = (payload && payload.simulatorsMeta) || {};
  var showcase = (payload && (payload.showcaseMeta || payload.showcaseStore)) || {};
  Object.keys(meta).forEach(function (id) {
    ids[id] = true;
  });
  Object.keys(showcase).forEach(function (id) {
    if (id.charAt(0) !== '_') ids[id] = true;
  });
  return Object.keys(ids);
}

export function hasUnresolvedSimulatorMedia(payload) {
  var meta = (payload && payload.simulatorsMeta) || {};
  var showcase = (payload && (payload.showcaseMeta || payload.showcaseStore)) || {};

  var unresolvedIcon = Object.keys(meta).some(function (id) {
    var entry = meta[id];
    if (!entry || !entry.icon) return false;
    if (isEphemeralPreviewUrl(entry.icon)) return true;
    if (entry.iconType === 'image' && rejectDataUrl(entry.icon) && !isDataUrlSvg(entry.icon)) {
      if (dataUrlSizeKb(entry.icon) > MAX_ICON_KB) return true;
    }
    return false;
  });

  if (unresolvedIcon) return true;

  return Object.keys(showcase).some(function (id) {
    if (id.charAt(0) === '_') return false;
    var entry = showcase[id];
    return !!(entry && entry.showcaseImage && isEphemeralPreviewUrl(entry.showcaseImage));
  });
}

function payloadHasBlobMedia(payload) {
  var meta = (payload && payload.simulatorsMeta) || {};
  var showcase = (payload && (payload.showcaseMeta || payload.showcaseStore)) || {};
  var iconBlob = Object.keys(meta).some(function (id) {
    var entry = meta[id];
    return !!(entry && entry.icon && isEphemeralPreviewUrl(entry.icon));
  });
  if (iconBlob) return true;
  return Object.keys(showcase).some(function (id) {
    if (id.charAt(0) === '_') return false;
    var entry = showcase[id];
    return !!(entry && entry.showcaseImage && isEphemeralPreviewUrl(entry.showcaseImage));
  });
}

function hasPendingSimulatorFiles(pendingIcons, pendingShowcase) {
  var pendingIconMap = pendingIcons && typeof pendingIcons === 'object' ? pendingIcons : {};
  var pendingShowcaseMap = pendingShowcase && typeof pendingShowcase === 'object' ? pendingShowcase : {};
  return (
    Object.keys(pendingIconMap).some(function (k) {
      return pendingIconMap[k];
    }) ||
    Object.keys(pendingShowcaseMap).some(function (k) {
      return pendingShowcaseMap[k];
    })
  );
}

function buildFirestorePayloadShape(payload) {
  var src = payload && typeof payload === 'object' ? payload : {};
  return {
    simulatorsMeta: src.simulatorsMeta || {},
    showcaseStore: src.showcaseMeta || src.showcaseStore || {},
    platformSettings: src.platformSettings || {},
  };
}

export function measureSimulatorsPayloadBytes(payload) {
  return new Blob([JSON.stringify(buildFirestorePayloadShape(payload))]).size;
}

export function assertSimulatorsPayloadWithinFirestoreLimit(payload) {
  var bytes = measureSimulatorsPayloadBytes(payload);
  console.log('[CMS Media] Firestore payload size:', (bytes / 1024).toFixed(2), 'KB');
  if (bytes > MAX_FIRESTORE_PAYLOAD_BYTES) {
    throw new Error(
      'بيانات المحاكيات غير صالحة أو كبيرة جداً لـ Firestore — استخدم صوراً أصغر أو أعد رفع الأيقونات'
    );
  }
  return bytes;
}

async function ensureLeanIconDataUri(simId, iconValue) {
  var str = String(iconValue || '').trim();
  if (!str || isCloudStorageUrl(str) || isDataUrlSvg(str)) {
    return str;
  }
  if (!rejectDataUrl(str)) {
    return str;
  }
  var rasterFile = await dataUrlToFile(str, simId + '-icon.webp');
  return compressIconForFirestore(rasterFile);
}

async function ensureLeanShowcaseDataUri(simId, imageValue) {
  var str = String(imageValue || '').trim();
  if (!str || isCloudStorageUrl(str) || isDataUrlSvg(str)) {
    return str;
  }
  if (!rejectDataUrl(str)) {
    return str;
  }
  if (dataUrlSizeKb(str) <= SHOWCASE_MAX_KB) {
    return str;
  }
  try {
    var rasterFile = await dataUrlToFile(str, simId + '-showcase.webp');
    return compressShowcaseForFirestore(rasterFile);
  } catch (err) {
    console.warn('[CMS Media] Clearing oversized showcase image for', simId, err);
    return '';
  }
}

/**
 * Compress media to lean data URIs and validate total Firestore payload size.
 */
export async function prepareSimulatorsPayloadForFirestore(payload, pendingIcons, pendingShowcase, onProgress) {
  var src = payload && typeof payload === 'object' ? payload : {};
  var meta = Object.assign({}, src.simulatorsMeta || {});
  var showcase = Object.assign({}, src.showcaseMeta || src.showcaseStore || {});
  var pendingIconMap = pendingIcons && typeof pendingIcons === 'object' ? pendingIcons : {};
  var pendingShowcaseMap = pendingShowcase && typeof pendingShowcase === 'object' ? pendingShowcase : {};
  var reportProgress = typeof onProgress === 'function' ? onProgress : function () {};

  var ids = catalogIdsFromPayload(src);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var stepBase = 30 + Math.round((i / Math.max(ids.length, 1)) * 45);
    reportProgress(stepBase);

    var metaEntry = meta[id];
    if (metaEntry && (pendingIconMap[id] || isEphemeralPreviewUrl(metaEntry.icon))) {
      console.log('[CMS] Compressing icon for', id, '(' + (i + 1) + '/' + ids.length + ')');
      meta[id] = Object.assign({}, metaEntry, {
        iconType: 'image',
        icon: await resolveSimulatorIconValue(id, metaEntry.icon, pendingIconMap[id]),
      });
      metaEntry = meta[id];
    } else if (metaEntry && metaEntry.icon && shouldResolveSimulatorIcon(metaEntry)) {
      meta[id] = Object.assign({}, metaEntry, {
        iconType: 'image',
        icon: await ensureLeanIconDataUri(id, metaEntry.icon),
      });
      metaEntry = meta[id];
    }

    var showcaseEntry = showcase[id];
    if (showcaseEntry && (pendingShowcaseMap[id] || isEphemeralPreviewUrl(showcaseEntry.showcaseImage))) {
      console.log('[CMS] Compressing showcase image for', id, '(' + (i + 1) + '/' + ids.length + ')');
      showcase[id] = Object.assign({}, showcaseEntry, {
        showcaseImage: await resolveShowcaseImageValue(
          id,
          showcaseEntry.showcaseImage,
          pendingShowcaseMap[id]
        ),
      });
    } else if (showcaseEntry && showcaseEntry.showcaseImage) {
      showcase[id] = Object.assign({}, showcaseEntry, {
        showcaseImage: await ensureLeanShowcaseDataUri(id, showcaseEntry.showcaseImage),
      });
    }
  }

  reportProgress(78);

  var prepared = Object.assign({}, src, {
    simulatorsMeta: meta,
    showcaseMeta: showcase,
  });

  assertSimulatorsPayloadWithinFirestoreLimit(prepared);
  return prepared;
}

export function assertSimulatorsMediaReady(payload) {
  if (payloadHasBlobMedia(payload)) {
    throw new Error('ما زالت هناك صور محاكيات غير جاهزة للنشر — أعد رفع الصور ثم احفظ مرة أخرى.');
  }
  assertSimulatorsPayloadWithinFirestoreLimit(payload);
}

/** @deprecated Use assertSimulatorsMediaReady */
export function assertNoDataUrlsInSimulatorsPayload(payload) {
  assertSimulatorsMediaReady(payload);
}
