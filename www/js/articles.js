/**
 * Public technical articles — Firestore (articles) with localStorage fallback.
 */
(function (global) {
  'use strict';

  var KEY = 'ifa_platform_articles';

  var ALLOWED_TAGS = {
    p: 1,
    div: 1,
    span: 1,
    br: 1,
    strong: 1,
    em: 1,
    b: 1,
    i: 1,
    u: 1,
    h1: 1,
    h2: 1,
    h3: 1,
    h4: 1,
    h5: 1,
    h6: 1,
    ul: 1,
    ol: 1,
    li: 1,
    a: 1,
    img: 1,
    blockquote: 1,
  };

  var ALLOWED_ATTRS = {
    style: 1,
    class: 1,
    href: 1,
    src: 1,
    alt: 1,
    title: 1,
    width: 1,
    height: 1,
    dir: 1,
    target: 1,
    rel: 1,
    'data-cms-layout': 1,
    'data-cms-position': 1,
  };

  function uid() {
    return 'art-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isAdminPreview() {
    try {
      if (global.self !== global.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(global.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function normalizeStatus(value) {
    if (global.CmsStatus && typeof global.CmsStatus.normalize === 'function') {
      return global.CmsStatus.normalize(value);
    }
    var s = String(value == null ? '' : value).trim().toLowerCase();
    if (s === 'trash' || s === 'deleted') return 'trash';
    if (s === 'draft' || s === 'hidden') return 'draft';
    return 'published';
  }

  function isActiveStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isActive === 'function') {
      return global.CmsStatus.isActive(status);
    }
    var s = normalizeStatus(status);
    return s === 'published' || s === 'draft';
  }

  function isTrashStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isTrash === 'function') {
      return global.CmsStatus.isTrash(status);
    }
    return normalizeStatus(status) === 'trash';
  }

  function isPublishedStatus(status) {
    if (global.CmsStatus && typeof global.CmsStatus.isPublished === 'function') {
      return global.CmsStatus.isPublished(status);
    }
    return normalizeStatus(status) === 'published';
  }

  function defaultArticles() {
    return [
      {
        id: 'art-otdr',
        title: 'أساسيات قراءة منحنى OTDR',
        category: 'دليل فني',
        tags: 'OTDR, أعطال, قياس',
        image: '',
        excerpt: 'تعرّف على كيفية تفسير الأحداث، نقاط الخسارة، والانعكاسات لتحديد مواقع الأعطال بدقة.',
        body:
          '<p>تعرّف على كيفية تفسير الأحداث، نقاط الخسارة، والانعكاسات لتحديد مواقع الأعطال بدقة.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم فريق التدريب · 8 دقائق قراءة',
        status: 'published',
      },
      {
        id: 'art-gpon',
        title: 'أفضل ممارسات تصميم شبكة GPON',
        category: 'محتوى المدربين',
        tags: 'GPON, تصميم, FTTH',
        image: '',
        excerpt: 'إرشادات من المدربين حول تخطيط التقسيم، حساب الميزانية البصرية، وتجنب الأخطاء الشائعة في الميدان.',
        body:
          '<p>إرشادات من المدربين حول تخطيط التقسيم، حساب الميزانية البصرية، وتجنب الأخطاء الشائعة في الميدان.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم المدربين · 12 دقيقة قراءة',
        status: 'published',
      },
      {
        id: 'art-splice',
        title: 'دليل اللحام البصري خطوة بخطوة',
        category: 'دليل تركيبي',
        tags: 'Fusion, لحام, تركيب',
        image: '',
        excerpt: 'شرح عملي لعملية Fusion Splicing من التحضير حتى اختبار الخسارة، مع نصائح للنتائج الاحترافية.',
        body:
          '<p>شرح عملي لعملية Fusion Splicing من التحضير حتى اختبار الخسارة، مع نصائح للنتائج الاحترافية.</p>',
        fontFamily: '',
        fontSize: '',
        textColor: '',
        meta: 'بقلم فريق الأكاديمية · 10 دقائق قراءة',
        status: 'published',
      },
    ];
  }

  function sortArticles(list) {
    return (list || []).slice().sort(function (a, b) {
      var orderA = isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0;
      var orderB = isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 0;
      if (orderA !== orderB) return orderA - orderB;
      return String(a.id || '').localeCompare(String(b.id || ''));
    });
  }

  function readLocalArticles() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return sortArticles(parsed.map(normalizeArticle));
    } catch (err) {
      return null;
    }
  }

  function usesFirestoreArticles() {
    return !!(
      global.PlatformArticlesFirestore &&
      typeof global.PlatformArticlesFirestore.isReady === 'function' &&
      global.PlatformArticlesFirestore.isReady()
    );
  }

  function hasFirestoreArticlesCache() {
    return !!(
      global.PlatformArticlesFirestore &&
      typeof global.PlatformArticlesFirestore.getCachedArticles === 'function' &&
      global.PlatformArticlesFirestore.getCachedArticles().length
    );
  }

  function isFirestoreArticlesBootstrapping() {
    return !!(
      global.PlatformArticlesFirestore &&
      typeof global.PlatformArticlesFirestore.isReady === 'function' &&
      !global.PlatformArticlesFirestore.isReady() &&
      !hasFirestoreArticlesCache()
    );
  }

  function sanitizeAttrValue(name, value) {
    var v = String(value == null ? '' : value);
    if (/^on/i.test(name)) return '';
    if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(v)) return '';
    return v;
  }

  function sanitizeNode(node) {
    if (!node) return null;
    if (node.nodeType === 3) return node.cloneNode(false);
    if (node.nodeType !== 1) return null;

    var tag = node.tagName ? node.tagName.toLowerCase() : '';
    if (!ALLOWED_TAGS[tag]) {
      var frag = document.createDocumentFragment();
      var children = node.childNodes;
      var i;
      for (i = 0; i < children.length; i++) {
        var child = sanitizeNode(children[i]);
        if (child) frag.appendChild(child);
      }
      return frag;
    }

    var clean = document.createElement(tag);
    var attrs = node.attributes;
    var j;
    for (j = 0; j < attrs.length; j++) {
      var attr = attrs[j];
      if (!ALLOWED_ATTRS[attr.name]) continue;
      var safeVal = sanitizeAttrValue(attr.name, attr.value);
      if (safeVal !== '') clean.setAttribute(attr.name, safeVal);
    }

    var kids = node.childNodes;
    for (j = 0; j < kids.length; j++) {
      var sanitizedChild = sanitizeNode(kids[j]);
      if (!sanitizedChild) continue;
      if (sanitizedChild.nodeType === 11) {
        while (sanitizedChild.firstChild) clean.appendChild(sanitizedChild.firstChild);
      } else {
        clean.appendChild(sanitizedChild);
      }
    }
    return clean;
  }

  function sanitizeArticleHtml(html) {
    var raw = String(html || '');
    if (!raw.trim()) return '';
    var template = document.createElement('template');
    template.innerHTML = raw;
    var out = document.createElement('div');
    var nodes = template.content.childNodes;
    var i;
    for (i = 0; i < nodes.length; i++) {
      var part = sanitizeNode(nodes[i]);
      if (!part) continue;
      if (part.nodeType === 11) {
        while (part.firstChild) out.appendChild(part.firstChild);
      } else {
        out.appendChild(part);
      }
    }
    return out.innerHTML;
  }

  function getAllArticles() {
    if (isFirestoreArticlesBootstrapping()) {
      return [];
    }
    if (usesFirestoreArticles()) {
      return sortArticles(global.PlatformArticlesFirestore.getCachedArticles());
    }
    var local = readLocalArticles();
    if (local && local.length) return local;
    return defaultArticles();
  }

  function getArticles() {
    return getAllArticles().filter(function (a) {
      return isActiveStatus(a.status);
    });
  }

  function getTrashedArticles() {
    return getAllArticles().filter(function (a) {
      return isTrashStatus(a.status);
    });
  }

  function getPublishedArticles() {
    if (usesFirestoreArticles()) {
      return sortArticles(global.PlatformArticlesFirestore.getCachedArticles()).filter(function (a) {
        return isPublishedStatus(a.status);
      });
    }

    var published = getAllArticles().filter(function (a) {
      return isPublishedStatus(a.status);
    });
    if (published.length) return published;

    var local = readLocalArticles();
    if (local && local.length) return [];

    return defaultArticles().filter(function (a) {
      return isPublishedStatus(a.status);
    });
  }

  function normalizeArticle(item) {
    var a = item && typeof item === 'object' ? item : {};
    return {
      id: String(a.id || uid()),
      title: String(a.title || '').trim(),
      category: String(a.category || '').trim(),
      tags: String(a.tags || '').trim(),
      image: String(a.image || ''),
      excerpt: String(a.excerpt || '').trim(),
      body: sanitizeArticleHtml(a.body || ''),
      fontFamily: String(a.fontFamily || ''),
      fontSize: String(a.fontSize || ''),
      textColor: String(a.textColor || ''),
      meta: String(a.meta || '').trim(),
      status: normalizeStatus(a.status),
      sortOrder: isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : 0,
    };
  }

  function saveArticles(list) {
    if (usesFirestoreArticles()) {
      console.warn(
        '[PlatformArticles] saveArticles ignored while Firestore sync is active — use PlatformArticlesFirestore CRUD'
      );
      return sortArticles((Array.isArray(list) ? list : []).map(normalizeArticle));
    }
    var next = sortArticles((Array.isArray(list) ? list : []).map(normalizeArticle));
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch (err) {
      console.error('[PlatformArticles] save failed', err);
    }
    renderPublic();
    try {
      global.dispatchEvent(new CustomEvent('ifa:platform-articles-changed'));
    } catch (err2) {
      /* ignore */
    }
    return next;
  }

  function upsertArticle(article) {
    if (usesFirestoreArticles()) {
      console.warn(
        '[PlatformArticles] upsertArticle ignored while Firestore sync is active — use PlatformArticlesFirestore CRUD'
      );
      return normalizeArticle(article);
    }
    var list = getAllArticles();
    var item = normalizeArticle(article);
    if (!item.id) item.id = uid();
    var idx = -1;
    list.forEach(function (a, i) {
      if (a.id === item.id) idx = i;
    });
    if (idx === -1) list.unshift(item);
    else list[idx] = item;
    return saveArticles(list);
  }

  function deleteArticle(id) {
    if (usesFirestoreArticles()) {
      console.warn(
        '[PlatformArticles] deleteArticle ignored while Firestore sync is active — use PlatformArticlesFirestore CRUD'
      );
      return getArticles();
    }
    var list = getAllArticles();
    var key = String(id || '');
    var found = false;
    list.forEach(function (a) {
      if (String(a.id) === key) {
        a.status = 'trash';
        found = true;
      }
    });
    if (!found) return getArticles();
    return saveArticles(list);
  }

  function excerptFrom(article) {
    if (article.excerpt) return article.excerpt;
    var text = String(article.body || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, 160);
  }

  function bodyStyle(article) {
    var parts = [];
    if (article.fontFamily) parts.push('font-family:' + article.fontFamily);
    if (article.fontSize) parts.push('font-size:' + article.fontSize);
    if (article.textColor) parts.push('color:' + article.textColor);
    return parts.join(';');
  }

  function cardHtml(article) {
    var img = article.image
      ? '<img class="article-card__image" src="' +
        escapeHtml(article.image) +
        '" alt="' +
        escapeHtml(article.title) +
        '" />'
      : '';
    var tags = article.tags
      ? '<span class="article-card__meta">' + escapeHtml(article.tags) + '</span>'
      : '';
    return (
      '<article class="article-card fade-in visible" data-article-id="' +
      escapeHtml(article.id) +
      '" role="button" tabindex="0">' +
      img +
      (article.category
        ? '<span class="article-card__category">' + escapeHtml(article.category) + '</span>'
        : '') +
      '<h3 class="article-card__title">' +
      escapeHtml(article.title) +
      '</h3>' +
      '<p class="article-card__desc">' +
      escapeHtml(excerptFrom(article)) +
      '</p>' +
      (article.meta ? '<span class="article-card__meta">' + escapeHtml(article.meta) + '</span>' : tags) +
      '</article>'
    );
  }

  function ensureArticleReaderModal() {
    var modal = document.getElementById('article-reader-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'article-reader';
    modal.id = 'article-reader-modal';
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    modal.innerHTML =
      '<div class="article-reader__backdrop" data-article-reader-close></div>' +
      '<div class="article-reader__dialog" role="dialog" aria-modal="true" aria-labelledby="articleReaderTitle">' +
      '<header class="article-reader__toolbar">' +
      '<button type="button" class="article-reader__close" data-article-reader-close aria-label="إغلاق">✕ إغلاق</button>' +
      '</header>' +
      '<div class="article-reader__scroll">' +
      '<img class="article-reader__cover" id="articleReaderCover" alt="" hidden />' +
      '<span class="article-reader__category" id="articleReaderCategory" hidden></span>' +
      '<h1 class="article-reader__title" id="articleReaderTitle"></h1>' +
      '<p class="article-reader__meta" id="articleReaderMeta"></p>' +
      '<div class="article-reader__body article-body" id="articleReaderBody"></div>' +
      '</div></div>';
    document.body.appendChild(modal);
    return modal;
  }

  function closeArticleReader() {
    var modal = document.getElementById('article-reader-modal');
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('article-reader-open');
  }

  function openArticleReader(article) {
    if (!article) return;
    var modal = ensureArticleReaderModal();
    var cover = document.getElementById('articleReaderCover');
    var category = document.getElementById('articleReaderCategory');
    var title = document.getElementById('articleReaderTitle');
    var meta = document.getElementById('articleReaderMeta');
    var body = document.getElementById('articleReaderBody');

    if (cover) {
      if (article.image) {
        cover.hidden = false;
        cover.src = article.image;
        cover.alt = article.title || '';
      } else {
        cover.hidden = true;
        cover.removeAttribute('src');
      }
    }
    if (category) {
      if (article.category) {
        category.hidden = false;
        category.textContent = article.category;
      } else {
        category.hidden = true;
        category.textContent = '';
      }
    }
    if (title) title.textContent = article.title || '';
    if (meta) meta.textContent = article.meta || article.tags || '';
    if (body) {
      body.innerHTML = sanitizeArticleHtml(article.body || '') || '<p>' + escapeHtml(excerptFrom(article)) + '</p>';
      body.style.cssText = bodyStyle(article);
    }

    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('article-reader-open');
  }

  function findArticleById(id) {
    var key = String(id || '');
    if (!key) return null;
    var found = null;
    getArticles().forEach(function (a) {
      if (String(a.id) === key) found = a;
    });
    if (found || usesFirestoreArticles()) return found;
    defaultArticles().forEach(function (a) {
      if (String(a.id) === key) found = a;
    });
    return found;
  }

  function bindArticleReader() {
    if (bindArticleReader._bound) return;
    bindArticleReader._bound = true;

    document.addEventListener('click', function (e) {
      var closeBtn = e.target.closest ? e.target.closest('[data-article-reader-close]') : null;
      if (closeBtn) {
        closeArticleReader();
        return;
      }
      var card = e.target.closest ? e.target.closest('.article-card[data-article-id]') : null;
      if (!card) return;
      var article = findArticleById(card.getAttribute('data-article-id'));
      if (article) openArticleReader(article);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeArticleReader();
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest ? e.target.closest('.article-card[data-article-id]') : null;
      if (!card) return;
      e.preventDefault();
      var article = findArticleById(card.getAttribute('data-article-id'));
      if (article) openArticleReader(article);
    });
  }

  function findPublicArticlesHost() {
    return (
      document.getElementById('articles-grid') ||
      document.querySelector('.articles-container') ||
      document.querySelector('.articles__grid') ||
      document.getElementById('publicArticlesGrid')
    );
  }

  function renderPublic() {
    var grid = findPublicArticlesHost();
    if (!grid) return;
    grid.style.display = 'grid';
    var list = getPublishedArticles();
    if (isAdminPreview()) {
      var all = getArticles();
      if (all.length) list = all;
    }
    if (list.length) {
      grid.innerHTML = list.map(cardHtml).join('');
    } else if (isAdminPreview()) {
      grid.innerHTML = '';
    } else {
      grid.innerHTML =
        '<p class="articles__empty" role="status">لا توجد مقالات منشورة حالياً.</p>';
    }
    if (typeof global.reobserveAnimations === 'function') {
      global.reobserveAnimations(grid);
    }
  }

  function loadPublicArticles() {
    renderPublic();
  }

  function bindPublic() {
    try {
      renderPublic();
      bindArticleReader();
    } catch (err) {
      console.error('[PlatformArticles] public render failed', err);
    }
    global.addEventListener('storage', function (e) {
      if (usesFirestoreArticles()) return;
      if (!e.key || e.key === KEY) renderPublic();
    });
    global.addEventListener('ifa:platform-articles-changed', renderPublic);
    global.addEventListener('ifa:articles-firestore-changed', renderPublic);
    document.addEventListener('ifa:articles-firestore-changed', renderPublic);
    global.addEventListener('load', renderPublic);

    (function waitForFirestoreArticles(attempts) {
      if (
        global.PlatformArticlesFirestore &&
        typeof global.PlatformArticlesFirestore.subscribe === 'function'
      ) {
        global.PlatformArticlesFirestore.subscribe(function () {
          renderPublic();
        });
        return;
      }
      if (attempts > 40) return;
      global.setTimeout(function () {
        waitForFirestoreArticles(attempts + 1);
      }, 50);
    })(0);
  }

  global.PlatformArticles = {
    KEY: KEY,
    uid: uid,
    normalizeArticle: normalizeArticle,
    getArticles: getArticles,
    getAllArticles: getAllArticles,
    getTrashedArticles: getTrashedArticles,
    getPublishedArticles: getPublishedArticles,
    saveArticles: saveArticles,
    upsertArticle: upsertArticle,
    deleteArticle: deleteArticle,
    defaultArticles: defaultArticles,
    renderPublic: renderPublic,
    loadPublicArticles: loadPublicArticles,
    openArticleReader: openArticleReader,
    closeArticleReader: closeArticleReader,
    bodyStyle: bodyStyle,
    sanitizeArticleHtml: sanitizeArticleHtml,
    isAdminPreview: isAdminPreview,
    usesFirestore: usesFirestoreArticles,
  };
  global.loadPublicArticles = loadPublicArticles;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPublic);
  } else {
    bindPublic();
  }
})(typeof window !== 'undefined' ? window : this);
