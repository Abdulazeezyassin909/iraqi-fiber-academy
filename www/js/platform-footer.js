/**
 * Dynamic site footer — brand description, social links (ifa_platform_footer).
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_footer';

  var DEFAULT_DESCRIPTION =
    'منصة تدريبية رائدة في مجال الألياف الضوئية وشبكات FTTH. نُعدّ الجيل القادم من فنيي ومهندسي الاتصالات.';

  var DEFAULT_LOGO_SUBTITLE = 'منصة المسار المهني الهندسي';

  var SOCIAL_ORDER = [
    { id: 'youtube', label: 'YouTube', icon: 'youtube' },
    { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
    { id: 'email', label: 'البريد الإلكتروني', icon: 'email' },
    { id: 'phone', label: 'رقم الهاتف', icon: 'phone' },
    { id: 'facebook', label: 'Facebook', icon: 'facebook' },
    { id: 'instagram', label: 'Instagram', icon: 'instagram' },
    { id: 'telegram', label: 'Telegram', icon: 'telegram' },
    { id: 'whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
  ];

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function readJson() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (err) {
      return null;
    }
  }

  function clampFontSize(value) {
    var n = parseFloat(value);
    if (!isFinite(n) || n < 0.65) n = 0.9;
    if (n > 1.5) n = 1.5;
    return Math.round(n * 100) / 100;
  }

  function clampLogoSubtitleFontSize(value) {
    var n = parseFloat(value);
    if (!isFinite(n) || n < 0.5) n = 0.85;
    if (n > 1.5) n = 1.5;
    return Math.round(n * 100) / 100;
  }

  function normalizeColor(value, fallback) {
    var c = String(value || '').trim();
    if (!c) return fallback;
    if (/^#[0-9a-fA-F]{3,8}$/.test(c)) return c;
    if (/^rgba?\(/i.test(c)) return c;
    return fallback;
  }

  function normalizeSocialUrl(id, value) {
    var v = String(value || '').trim();
    if (!v) return '';
    if (id === 'email') {
      if (/^mailto:/i.test(v)) return v;
      if (v.indexOf('@') !== -1) return 'mailto:' + v;
      return v;
    }
    if (id === 'phone') {
      if (/^tel:/i.test(v)) return v;
      var digits = v.replace(/[^\d+]/g, '');
      return digits ? 'tel:' + digits : v;
    }
    if (id === 'whatsapp') {
      if (/^https?:\/\//i.test(v) || /^whatsapp:/i.test(v)) return v;
      var wa = v.replace(/[^\d+]/g, '');
      return wa ? 'https://wa.me/' + wa.replace(/^\+/, '') : v;
    }
    if (id === 'telegram') {
      if (/^https?:\/\//i.test(v) || /^tg:/i.test(v)) return v;
      if (v.charAt(0) === '@') return 'https://t.me/' + v.slice(1);
      if (v.indexOf('t.me/') !== -1) return v.indexOf('http') === 0 ? v : 'https://' + v.replace(/^\/\//, '');
      return 'https://t.me/' + v.replace(/^@/, '');
    }
    if (!/^https?:\/\//i.test(v)) return 'https://' + v.replace(/^\/\//, '');
    return v;
  }

  function defaultSettings() {
    var social = {};
    SOCIAL_ORDER.forEach(function (item) {
      social[item.id] = '';
    });
    return {
      description: {
        text: DEFAULT_DESCRIPTION,
        fontSize: 0.9,
        color: '#94a3b8',
      },
      logoSubtitle: {
        text: DEFAULT_LOGO_SUBTITLE,
        fontSize: 0.85,
      },
      social: social,
    };
  }

  function usesFirestoreFooter() {
    return !!(
      global.PlatformFooterFirestore &&
      typeof global.PlatformFooterFirestore.isReady === 'function' &&
      global.PlatformFooterFirestore.isReady()
    );
  }

  function normalizeSettings(raw) {
    var base = defaultSettings();
    var src = raw && typeof raw === 'object' ? raw : {};
    var desc = src.description && typeof src.description === 'object' ? src.description : {};
    if (typeof src.description === 'string') {
      base.description.text = String(src.description).trim() || DEFAULT_DESCRIPTION;
      base.description.fontSize = clampFontSize(
        src.fontSize != null ? src.fontSize : base.description.fontSize
      );
    } else {
      base.description.text = String(desc.text != null ? desc.text : base.description.text).trim() || DEFAULT_DESCRIPTION;
      base.description.fontSize = clampFontSize(desc.fontSize != null ? desc.fontSize : base.description.fontSize);
      base.description.color = normalizeColor(desc.color, base.description.color);
    }
    if (src.fontSize != null && typeof src.description !== 'object') {
      base.description.fontSize = clampFontSize(src.fontSize);
    }
    if (typeof src.description === 'object' && src.description) {
      base.description.color = normalizeColor(desc.color, base.description.color);
    }
    var incomingSocial = src.social && typeof src.social === 'object' ? src.social : {};
    SOCIAL_ORDER.forEach(function (item) {
      base.social[item.id] = normalizeSocialUrl(item.id, incomingSocial[item.id] || '');
    });
    var logoSub = src.logoSubtitle && typeof src.logoSubtitle === 'object' ? src.logoSubtitle : {};
    base.logoSubtitle.text =
      String(logoSub.text != null ? logoSub.text : base.logoSubtitle.text).trim() || DEFAULT_LOGO_SUBTITLE;
    base.logoSubtitle.fontSize = clampLogoSubtitleFontSize(
      logoSub.fontSize != null ? logoSub.fontSize : base.logoSubtitle.fontSize
    );
    return base;
  }

  function getFooterSettings() {
    if (usesFirestoreFooter()) {
      return global.PlatformFooterFirestore.getCachedSettings();
    }
    return normalizeSettings(readJson());
  }

  function saveFooterSettings(patch) {
    var current = getFooterSettings();
    var incoming = patch && typeof patch === 'object' ? patch : {};
    if (incoming.description) {
      current.description = Object.assign({}, current.description, incoming.description);
      current.description.text = String(current.description.text || '').trim() || DEFAULT_DESCRIPTION;
      current.description.fontSize = clampFontSize(current.description.fontSize);
      current.description.color = normalizeColor(current.description.color, '#94a3b8');
    }
    if (incoming.social) {
      SOCIAL_ORDER.forEach(function (item) {
        if (incoming.social[item.id] != null) {
          current.social[item.id] = normalizeSocialUrl(item.id, incoming.social[item.id]);
        }
      });
    }
    if (incoming.logoSubtitle) {
      current.logoSubtitle = Object.assign({}, current.logoSubtitle, incoming.logoSubtitle);
      current.logoSubtitle.text =
        String(current.logoSubtitle.text || '').trim() || DEFAULT_LOGO_SUBTITLE;
      current.logoSubtitle.fontSize = clampLogoSubtitleFontSize(current.logoSubtitle.fontSize);
    }
    current = normalizeSettings(current);
    if (global.PlatformFooterFirestore && typeof global.PlatformFooterFirestore.saveSettings === 'function') {
      return global.PlatformFooterFirestore.saveSettings(patch);
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch (err) {
      console.error('[PlatformFooter] save failed', err);
    }
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-footer-changed', { detail: current }));
    } catch (err2) {
      /* ignore */
    }
    return Promise.resolve(current);
  }

  function socialIconSvg(type) {
    switch (type) {
      case 'youtube':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a31 31 0 0 0-.5-5.8zM9.6 15.6V8.4L15.8 12 9.6 15.6z"/></svg>';
      case 'linkedin':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.12 1 2.5 1 4.98 2.12 4.98 3.5zM.5 8.5h4V23.5h-4V8.5zM8.5 8.5h3.8v2.05h.05c.53-1 1.83-2.05 3.77-2.05 4.03 0 4.78 2.65 4.78 6.1v8.9h-4v-7.88c0-1.88-.03-4.3-2.62-4.3-2.62 0-3.02 2.05-3.02 4.17v8.01h-4V8.5z"/></svg>';
      case 'email':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg>';
      case 'phone':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.08 4.18 2 2 0 0 1 4.06 2h3a2 2 0 0 1 2 1.72c.12.86.33 1.7.62 2.5a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.58-1.14a2 2 0 0 1 2.11-.45c.8.29 1.64.5 2.5.62A2 2 0 0 1 22 16.92z"/></svg>';
      case 'facebook':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.41 0 12.07c0 6.03 4.39 11.03 10.13 11.93v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.68.23 2.68.23v2.96h-1.51c-1.49 0-1.95.93-1.95 1.88v2.26h3.32l-.53 3.49h-2.79v8.44C19.61 23.1 24 18.1 24 12.07z"/></svg>';
      case 'instagram':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.2" fill="currentColor" stroke="none"/></svg>';
      case 'telegram':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M9.9 15.6 9.7 20c.5 0 .7-.2 1-.5l2.4-2.3 5 3.7c.9.5 1.5.2 1.7-.8l3.3-15.5h0c.3-1.2-.4-1.7-1.2-1.4L1.2 9.8c-1.1.4-1.1 1 0 1.4l5.6 1.7L19.5 6.5c.6-.4 1.1-.2.7.2"/></svg>';
      case 'whatsapp':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>';
      default:
        return '<span aria-hidden="true">•</span>';
    }
  }

  function buildSocialHtml(settings) {
    return SOCIAL_ORDER.map(function (item) {
      var href = String((settings.social && settings.social[item.id]) || '').trim();
      if (!href) return '';
      var external = href.indexOf('mailto:') !== 0 && href.indexOf('tel:') !== 0;
      return (
        '<a class="footer__social-link" data-social-id="' +
        escapeHtml(item.id) +
        '" href="' +
        escapeHtml(href) +
        '" aria-label="' +
        escapeHtml(item.label) +
        '"' +
        (external ? ' target="_blank" rel="noopener noreferrer"' : '') +
        '>' +
        socialIconSvg(item.icon) +
        '</a>'
      );
    }).join('');
  }

  function applyLogoSubtitle(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var settings = getFooterSettings();
    var sub = settings.logoSubtitle || {};
    var text = String(sub.text || '').trim() || DEFAULT_LOGO_SUBTITLE;
    var fontSize = clampLogoSubtitleFontSize(sub.fontSize);
    scope.querySelectorAll('.logo__text-sub').forEach(function (el) {
      el.textContent = text;
      el.style.setProperty('font-size', fontSize + 'rem', 'important');
    });
    return settings;
  }

  function applyFooter(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var settings = getFooterSettings();

    applyLogoSubtitle(scope);

    var descEl = scope.querySelector('[data-footer-desc]');
    if (descEl) {
      descEl.textContent = settings.description.text;
      descEl.style.fontSize = settings.description.fontSize + 'rem';
      descEl.style.color = settings.description.color;
    }

    var socialEl = scope.querySelector('[data-footer-social]');
    if (socialEl) {
      socialEl.innerHTML = buildSocialHtml(settings);
    }

    return settings;
  }

  function bindFirestoreSubscription() {
    (function waitForFirestore(attempts) {
      if (global.PlatformFooterFirestore && typeof global.PlatformFooterFirestore.subscribe === 'function') {
        global.PlatformFooterFirestore.subscribe(function () {
          applyFooter(document);
        });
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestore(attempts + 1);
      }, 50);
    })(0);
  }

  function boot() {
    applyFooter(document);
    bindFirestoreSubscription();
  }

  global.PlatformFooter = {
    KEY: KEY,
    SOCIAL_ORDER: SOCIAL_ORDER,
    DEFAULT_DESCRIPTION: DEFAULT_DESCRIPTION,
    DEFAULT_LOGO_SUBTITLE: DEFAULT_LOGO_SUBTITLE,
    getFooterSettings: getFooterSettings,
    saveFooterSettings: saveFooterSettings,
    normalizeSettings: normalizeSettings,
    normalizeSocialUrl: normalizeSocialUrl,
    applyLogoSubtitle: applyLogoSubtitle,
    applyFooter: applyFooter,
    buildSocialHtml: buildSocialHtml,
    usesFirestore: usesFirestoreFooter,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.addEventListener('ifa:platform-footer-changed', function () {
    applyFooter(document);
  });
  global.addEventListener('storage', function (e) {
    if (usesFirestoreFooter()) return;
    if (e.key === KEY) applyFooter(document);
  });
})(typeof window !== 'undefined' ? window : this);
