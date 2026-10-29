/**
 * FAT Pole Transform Spy — catch any JS that writes style.transform on .fat-pole-icon
 * ───────────────────────────────────────────────────────────────────────────────
 * Loaded early from simulator.html (before ftth-simulator-core.js).
 *
 * HOW TO USE:
 *   1. Open simulator.html → DevTools Console (F12)
 *   2. Enable map rotation and rotate the map
 *   3. Watch for red logs: [FAT-POLE TRANSFORM SPY]
 *   4. The stack trace names the exact function writing transform
 *
 * Disable: window.__FTTH_POLE_TRANSFORM_SPY__ = false  (before this script loads)
 *   or:    localStorage.setItem('ftthPoleTransformSpy', '0')
 */
(function () {
  'use strict';

  if (window.__FTTH_POLE_TRANSFORM_SPY__ === false) return;
  if (localStorage.getItem('ftthPoleTransformSpy') === '0') return;
  window.__FTTH_POLE_TRANSFORM_SPY__ = true;

  var ATTR = 'data-ftth-pole-spy';
  var hitCount = 0;

  function isFatPoleTarget(el) {
    if (!el || !el.nodeType || el.nodeType !== 1) return false;
    if (el.classList) {
      if (el.classList.contains('fat-pole-icon')) return true;
      if (el.classList.contains('fat-handhole-base')) return true;
      if (el.classList.contains('fat-pole-glyph')) return true;
      if (el.classList.contains('field-glyph--fat-pole')) return true;
      if (el.classList.contains('fat-pole-path')) return true;
    }
    if (el.closest) {
      return !!(el.closest('.fat-pole-icon') || el.closest('.fat-handhole-base'));
    }
    return false;
  }

  function callerSummary(stack) {
    if (!stack) return '(no stack)';
    var lines = String(stack).split('\n').map(function (l) { return l.trim(); }).filter(Boolean);
    /* Skip Error + this spy frames */
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/fatPoleTransformSpy|poleTransformSpy|FAT-POLE TRANSFORM SPY/i.test(line)) continue;
      if (/^Error\b/.test(line)) continue;
      out.push(line);
      if (out.length >= 8) break;
    }
    return out.join('\n  ') || lines.slice(0, 6).join('\n  ');
  }

  function report(kind, el, value, extra) {
    hitCount += 1;
    var cls = el && el.className ? String(el.className) : '';
    var err = new Error('[FAT-POLE TRANSFORM SPY] #' + hitCount + ' ' + kind);
    console.warn(
      '%c[FAT-POLE TRANSFORM SPY]%c ' + kind,
      'color:#fff;background:#b91c1c;padding:2px 6px;border-radius:3px;font-weight:700',
      'color:#fecaca;font-weight:700',
      {
        hit: hitCount,
        element: el,
        className: cls,
        value: value,
        inlineStyle: el && el.getAttribute && el.getAttribute('style'),
        extra: extra || null,
      }
    );
    console.warn('%cSTACK (function writing transform) →%c\n  ' + callerSummary(err.stack),
      'color:#fbbf24;font-weight:700', 'color:#e2e8f0');
    console.trace('[FAT-POLE TRANSFORM SPY] console.trace');
  }

  /* ── 1) Hook CSSStyleDeclaration.transform setter + setProperty ── */
  try {
    var proto = CSSStyleDeclaration.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'transform');
    if (desc && desc.set && desc.configurable !== false) {
      Object.defineProperty(proto, 'transform', {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set: function (value) {
          try {
            /* Resolve owner element: compare style object identity */
            var owners = document.querySelectorAll(
              '.fat-pole-icon, .fat-handhole-base, .fat-pole-glyph, .field-glyph--fat-pole, .fat-pole-path'
            );
            for (var i = 0; i < owners.length; i++) {
              if (owners[i].style === this) {
                report('style.transform = setter', owners[i], value);
                break;
              }
            }
          } catch (e) { /* ignore */ }
          return desc.set.call(this, value);
        },
      });
    }

    var nativeSetProperty = proto.setProperty;
    if (typeof nativeSetProperty === 'function') {
      proto.setProperty = function (property, value, priority) {
        if (property && String(property).toLowerCase() === 'transform') {
          try {
            var owners = document.querySelectorAll(
              '.fat-pole-icon, .fat-handhole-base, .fat-pole-glyph, .field-glyph--fat-pole, .fat-pole-path'
            );
            for (var i = 0; i < owners.length; i++) {
              if (owners[i].style === this) {
                report('style.setProperty(transform)', owners[i], value, { priority: priority });
                break;
              }
            }
          } catch (e) { /* ignore */ }
        }
        return nativeSetProperty.call(this, property, value, priority);
      };
    }
  } catch (hookErr) {
    console.warn('[FAT-POLE TRANSFORM SPY] prototype hook failed', hookErr);
  }

  /* ── 2) Hook setAttribute('style'|'transform') ── */
  try {
    var nativeSetAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      if (isFatPoleTarget(this) && name) {
        var n = String(name).toLowerCase();
        if (n === 'transform' || (n === 'style' && /transform\s*:/i.test(String(value || '')))) {
          report('setAttribute(' + name + ')', this, value);
        }
      }
      return nativeSetAttribute.call(this, name, value);
    };
  } catch (attrErr) {
    console.warn('[FAT-POLE TRANSFORM SPY] setAttribute hook failed', attrErr);
  }

  /* ── 3) MutationObserver backup (style / transform attribute) ── */
  function installMutationSpy() {
    if (!document.documentElement || document.documentElement.getAttribute(ATTR)) return;
    document.documentElement.setAttribute(ATTR, '1');
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type !== 'attributes') continue;
        var el = m.target;
        if (!isFatPoleTarget(el)) continue;
        if (m.attributeName === 'transform') {
          report('MutationObserver @transform', el, el.getAttribute('transform'));
        } else if (m.attributeName === 'style') {
          var st = el.getAttribute('style') || '';
          if (/transform\s*:/i.test(st)) {
            report('MutationObserver @style', el, st);
          }
        }
      }
    });
    mo.observe(document.documentElement, {
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'transform'],
    });
    window.__FTTH_POLE_TRANSFORM_SPY_MO__ = mo;
  }

  /* ── 4) After map rotate: audit computed vs inline + SVG transform attrs ── */
  function auditComputed() {
    var icons = document.querySelectorAll('.fat-pole-icon');
    var zoom = document.getElementById('canvas-zoom-inner');
    var zoomT = zoom ? getComputedStyle(zoom).transform : '(no zoom-inner)';
    if (!icons.length) {
      console.info('[FAT-POLE TRANSFORM SPY] audit: no .fat-pole-icon in DOM yet');
      return;
    }
    icons.forEach(function (el, idx) {
      var inline = el.style && el.style.transform;
      var computed = getComputedStyle(el).transform;
      var svgWithTransform = [];
      el.querySelectorAll('svg, g, path, polygon').forEach(function (node) {
        if (node.hasAttribute && node.hasAttribute('transform')) {
          svgWithTransform.push({
            tag: node.tagName,
            className: node.className && node.className.baseVal != null
              ? node.className.baseVal
              : String(node.className || ''),
            transform: node.getAttribute('transform'),
          });
        }
      });
      console.info('[FAT-POLE TRANSFORM SPY] audit #' + idx, {
        inlineTransform: inline || '(empty — no JS inline transform)',
        computedTransform: computed,
        svgTransformAttrs: svgWithTransform.length ? svgWithTransform : '(none — good)',
        zoomInnerTransform: zoomT,
        className: el.className,
      });
      if (inline && inline !== 'none' && inline !== '') {
        console.warn('[FAT-POLE TRANSFORM SPY] INLINE transform present without a live write this tick — was set earlier:', inline);
      }
      if (svgWithTransform.length) {
        console.warn('[FAT-POLE TRANSFORM SPY] SVG transform attribute(s) still present:', svgWithTransform);
      }
    });
  }

  window.__FTTH_AUDIT_POLE_TRANSFORM__ = auditComputed;

  function bootSpy() {
    installMutationSpy();
    console.info(
      '%c[FAT-POLE TRANSFORM SPY] ACTIVE%c Rotate the map. If JS writes transform on .fat-pole-icon, a red stack appears. Run __FTTH_AUDIT_POLE_TRANSFORM__() anytime.',
      'color:#fff;background:#b91c1c;padding:2px 6px;border-radius:3px;font-weight:700',
      'color:#94a3b8'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootSpy);
  } else {
    bootSpy();
  }

  /* Re-audit when FTTH map transform flushes (if core exposes it later) */
  document.addEventListener('ftth-map-transform', auditComputed);
})();
