/**
 * Admin CMS modal for Fiber Optics Anatomy (visible in admin preview only).
 */
(function () {
  'use strict';

  var modalOpen = false;
  var activeTab = 'items';
  var selectedId = null;
  var selectedVariantId = null;

  function $(id) { return document.getElementById(id); }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function store() { return window.FiberAnatomyStore; }

  function isAdminPreviewContext() {
    try {
      if (window.self !== window.top) return true;
    } catch (err) {
      return true;
    }
    try {
      return new URLSearchParams(window.location.search).get('mode') === 'admin-preview';
    } catch (err2) {
      return false;
    }
  }

  function ensureModal() {
    if ($('anatomy-cms-modal')) return;
    var wrap = document.createElement('div');
    wrap.id = 'anatomy-cms-modal';
    wrap.className = 'anatomy-cms';
    wrap.hidden = true;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'anatomy-cms-title');
    wrap.innerHTML =
      '<div class="anatomy-cms__backdrop" data-cms-close></div>' +
      '<div class="anatomy-cms__panel">' +
        '<header class="anatomy-cms__header">' +
          '<div>' +
            '<h2 id="anatomy-cms-title">إعدادات محاكي التشريح</h2>' +
            '<p>إدارة الكيابل والدليل والوسائط — تُحفظ في هذا المتصفح</p>' +
          '</div>' +
          '<div class="anatomy-cms__toolbar">' +
            '<button type="button" class="anatomy-cms__btn" id="anatomy-cms-undo" title="Ctrl+Z">Undo</button>' +
            '<button type="button" class="anatomy-cms__btn" id="anatomy-cms-redo" title="Ctrl+Y">Redo</button>' +
            '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--warn" id="anatomy-cms-reset">Reset to Defaults</button>' +
            '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--primary" id="anatomy-cms-save">Save Changes</button>' +
            '<button type="button" class="anatomy-cms__btn" data-cms-close>إغلاق</button>' +
          '</div>' +
        '</header>' +
        '<div class="anatomy-cms__body">' +
          '<nav class="anatomy-cms__tabs" aria-label="CMS sections">' +
            '<button type="button" class="anatomy-cms__tab is-active" data-cms-tab="items">إدارة الكيابل</button>' +
            '<button type="button" class="anatomy-cms__tab" data-cms-tab="guides">دليل التشريح</button>' +
            '<button type="button" class="anatomy-cms__tab" data-cms-tab="media">وسائط العرض</button>' +
            '<button type="button" class="anatomy-cms__tab" data-cms-tab="variants">إدارة الأنواع الفرعية</button>' +
          '</nav>' +
          '<aside class="anatomy-cms__list" id="anatomy-cms-list"></aside>' +
          '<section class="anatomy-cms__editor" id="anatomy-cms-editor"></section>' +
        '</div>' +
        '<p class="anatomy-cms__status" id="anatomy-cms-status"></p>' +
      '</div>';
    document.body.appendChild(wrap);
    bindModal(wrap);
  }

  function setStatus(msg, isError) {
    var el = $('anatomy-cms-status');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-error', !!isError);
  }

  function currentItem() {
    var draft = store().getDraft();
    var id = selectedId;
    var found = draft.items.filter(function (it) { return it.id === id; })[0];
    if (found) return found;
    selectedId = draft.items[0] && draft.items[0].id;
    return draft.items[0] || null;
  }

  function renderList() {
    var host = $('anatomy-cms-list');
    if (!host) return;
    var draft = store().getDraft();
    var html = '';
    draft.categories.forEach(function (cat) {
      html += '<p class="anatomy-cms__cat">' + escapeHtml(cat.label) + '</p>';
      draft.items.filter(function (it) { return it.categoryId === cat.id; }).forEach(function (it) {
        html += '<button type="button" class="anatomy-cms__item' +
          (it.id === selectedId ? ' is-active' : '') +
          '" data-cms-select="' + escapeHtml(it.id) + '">' +
          '<strong>' + escapeHtml(it.label) + '</strong>' +
          '<span>' + escapeHtml(it.sublabel) + '</span></button>';
      });
    });
    html += '<div class="anatomy-cms__list-actions">' +
      '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--primary" id="anatomy-cms-add-cable">+ Cable</button>' +
      '<button type="button" class="anatomy-cms__btn" id="anatomy-cms-add-comp">+ Component</button>' +
      '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--danger" id="anatomy-cms-delete">Delete</button>' +
      '</div>';
    host.innerHTML = html;
  }

  function field(label, inner) {
    return '<label class="anatomy-cms__field"><span>' + label + '</span>' + inner + '</label>';
  }

  function iconPreviewHtml(icon) {
    if (icon && (icon.indexOf('data:image') === 0 || /\.(png|jpe?g|svg|webp)(\?|$)/i.test(icon) || icon.indexOf('http') === 0)) {
      return '<img alt="" src="' + escapeHtml(icon) + '">';
    }
    return '<span>' + escapeHtml(icon || '🧬') + '</span>';
  }

  function mediaHint(data, emptyLabel) {
    if (!data) return emptyLabel;
    return data.indexOf('data:') === 0 ? 'Embedded file stored in this browser.' : escapeHtml(String(data).slice(0, 80));
  }

  function renderVariantsEditor(item) {
    if (item.kind !== 'component') {
      return '<h3>إدارة الأنواع الفرعية</h3><p class="anatomy-cms__hint">Select a hardware item under Other Components (Splitter, ONU, FDT/FAT, …) to manage sub-variants.</p>';
    }
    var variants = item.variants || [];
    if (!selectedVariantId || !variants.some(function (v) { return v.id === selectedVariantId; })) {
      selectedVariantId = item.activeVariantId || (variants[0] && variants[0].id);
    }
    var html = '<h3>إدارة الأنواع الفرعية</h3>';
    html += '<p class="anatomy-cms__hint">Each variant can have its own guide text and 3D/2D media. Save Changes to apply to the workspace.</p>';
    html += field('Default active variant',
      '<select data-cms-field="activeVariantId">' +
      variants.map(function (v) {
        return '<option value="' + escapeHtml(v.id) + '"' +
          (v.id === item.activeVariantId ? ' selected' : '') + '>' +
          escapeHtml(v.label) + '</option>';
      }).join('') + '</select>');
    html += '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--primary" id="anatomy-cms-add-variant">+ Add New Variant</button>';
    variants.forEach(function (v) {
      var m3 = v.media3D || { type: 'procedural', data: '' };
      var m2 = v.media2D || { type: 'default-diagram', data: '' };
      html += '<section class="anatomy-cms__section anatomy-cms__variant-card">';
      html += '<div class="anatomy-cms__variant-head"><strong>' + escapeHtml(v.label) + '</strong>';
      html += '<button type="button" class="anatomy-cms__btn anatomy-cms__btn--danger" data-cms-delete-variant="' +
        escapeHtml(v.id) + '">Delete</button></div>';
      html += field('Variant Label',
        '<input data-cms-variant-field="label" data-variant-id="' + escapeHtml(v.id) +
        '" type="text" value="' + escapeHtml(v.label) + '">');
      html += field('Guide Description',
        '<textarea data-cms-variant-field="guideText" data-variant-id="' + escapeHtml(v.id) +
        '" rows="3">' + escapeHtml(v.guideText) + '</textarea>');
      html += field('3D model type',
        '<select data-cms-variant-field="renderType3D" data-variant-id="' + escapeHtml(v.id) + '">' +
          '<option value="procedural"' + (m3.type !== 'custom-glb' ? ' selected' : '') + '>Default Procedural 3D</option>' +
          '<option value="custom-glb"' + (m3.type === 'custom-glb' ? ' selected' : '') + '>Custom 3D (.glb / .gltf)</option>' +
        '</select>');
      html += '<label class="anatomy-cms__field"><span>Upload 3D Model (.glb/.gltf)</span>' +
        '<input type="file" data-variant-upload="3d" data-variant-id="' + escapeHtml(v.id) +
        '" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label>';
      html += '<p class="anatomy-cms__hint">' + mediaHint(m3.data, 'No custom 3D model') + '</p>';
      html += field('2D media type',
        '<select data-cms-variant-field="renderType2D" data-variant-id="' + escapeHtml(v.id) + '">' +
          '<option value="default-diagram"' + (m2.type !== 'custom-media' ? ' selected' : '') + '>Default Dynamic Diagram</option>' +
          '<option value="custom-media"' + (m2.type === 'custom-media' ? ' selected' : '') + '>Custom Schematic / Media</option>' +
        '</select>');
      html += '<label class="anatomy-cms__field"><span>Upload 2D Diagram/Media</span>' +
        '<input type="file" data-variant-upload="2d" data-variant-id="' + escapeHtml(v.id) +
        '" accept=".svg,.png,.jpg,.jpeg,.mp4,image/svg+xml,image/png,image/jpeg,video/mp4"></label>';
      html += '<p class="anatomy-cms__hint">' + mediaHint(m2.data, 'No custom 2D media') + '</p>';
      html += '</section>';
    });
    return html;
  }

  function renderEditor() {
    var host = $('anatomy-cms-editor');
    var item = currentItem();
    if (!host || !item) {
      if (host) host.innerHTML = '<p class="anatomy-cms__empty">No items</p>';
      return;
    }
    var cats = store().getDraft().categories;
    var catOpts = cats.map(function (c) {
      return '<option value="' + escapeHtml(c.id) + '"' +
        (c.id === item.categoryId ? ' selected' : '') + '>' +
        escapeHtml(c.label) + '</option>';
    }).join('');

    var html = '';
    if (activeTab === 'items') {
      html += '<h3>Cable Items CRUD</h3>';
      html += field('Label / Title',
        '<input data-cms-field="label" type="text" value="' + escapeHtml(item.label) + '">');
      html += field('Sub-label (tubes × strands)',
        '<input data-cms-field="sublabel" type="text" value="' + escapeHtml(item.sublabel) + '">');
      html += field('Category',
        '<select data-cms-field="categoryId">' + catOpts + '</select>');
      html += '<div class="anatomy-cms__icon-row">' +
        '<span>Sidebar icon</span>' +
        '<div class="anatomy-cms__icon-preview" id="anatomy-item-icon-preview">' +
          iconPreviewHtml(item.icon) +
        '</div>' +
        '<input type="file" id="anatomy-item-icon-input" accept="image/png, image/jpeg, image/svg+xml">' +
        '<input data-cms-field="icon" type="hidden" value="' + escapeHtml(item.icon) + '">' +
        '</div>';
      if (item.kind === 'cable') {
        html += field('Capacity (F)',
          '<input data-cms-field="capacity" type="number" min="1" value="' + escapeHtml(item.capacity) + '">');
        html += field('Tube count',
          '<input data-cms-field="tubeCount" type="number" min="1" max="24" value="' + escapeHtml(item.tubeCount) + '">');
        html += field('Strands per tube',
          '<select data-cms-field="strandsPerTube">' +
            '<option value="6"' + (item.strandsPerTube === 6 ? ' selected' : '') + '>6</option>' +
            '<option value="12"' + (item.strandsPerTube === 12 ? ' selected' : '') + '>12</option>' +
          '</select>');
        html += field('Dual ring / mid-stripe (288F style)',
          '<select data-cms-field="dualGroup">' +
            '<option value="0"' + (!item.dualGroup ? ' selected' : '') + '>No</option>' +
            '<option value="1"' + (item.dualGroup ? ' selected' : '') + '>Yes</option>' +
          '</select>');
      }
    } else if (activeTab === 'guides') {
      html += '<h3>Anatomy Guide Texts</h3>';
      html += field('Guide title',
        '<input data-cms-field="guideTitle" type="text" value="' + escapeHtml(item.guideTitle) + '">');
      html += field('Guide text',
        '<textarea data-cms-field="guideText" rows="8">' + escapeHtml(item.guideText) + '</textarea>');
    } else if (activeTab === 'media') {
      var m3 = item.media3D || { type: 'procedural', data: '' };
      var m2 = item.media2D || { type: 'default-diagram', data: '' };
      html += '<section class="anatomy-cms__section">' +
        '<h3>إعدادات العرض ثلاثي الأبعاد</h3>' +
        '<p class="anatomy-cms__hint">Used only when the simulator is in 3D View.</p>' +
        field('renderType3D',
          '<select id="renderType3D" data-cms-field="renderType3D">' +
            '<option value="procedural"' + (m3.type !== 'custom-glb' ? ' selected' : '') + '>Default Procedural 3D</option>' +
            '<option value="custom-glb"' + (m3.type === 'custom-glb' ? ' selected' : '') + '>Custom 3D Model (.glb / .gltf)</option>' +
          '</select>') +
        '<label class="anatomy-cms__field"><span>uploadFile3D</span>' +
        '<input type="file" id="uploadFile3D" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></label>' +
        '<p class="anatomy-cms__hint">' + mediaHint(m3.data, 'No custom 3D model stored') + '</p>' +
        '</section>';
      html += '<section class="anatomy-cms__section">' +
        '<h3>إعدادات المخطط ثنائي الأبعاد</h3>' +
        '<p class="anatomy-cms__hint">Used only when the simulator is in 2D Layout.</p>' +
        field('renderType2D',
          '<select id="renderType2D" data-cms-field="renderType2D">' +
            '<option value="default-diagram"' + (m2.type !== 'custom-media' ? ' selected' : '') + '>Default Dynamic Diagram</option>' +
            '<option value="custom-media"' + (m2.type === 'custom-media' ? ' selected' : '') + '>Custom Schematic / Media (Image/Video)</option>' +
          '</select>') +
        '<label class="anatomy-cms__field"><span>uploadFile2D</span>' +
        '<input type="file" id="uploadFile2D" accept=".svg,.png,.jpg,.jpeg,.mp4,image/svg+xml,image/png,image/jpeg,video/mp4"></label>' +
        '<p class="anatomy-cms__hint">' + mediaHint(m2.data, 'No custom 2D schematic stored') + '</p>' +
        '</section>';
    } else if (activeTab === 'variants') {
      html += renderVariantsEditor(item);
    }
    host.innerHTML = html;
  }

  function syncToolbar() {
    var undo = $('anatomy-cms-undo');
    var redo = $('anatomy-cms-redo');
    if (undo) undo.disabled = !store().canUndo();
    if (redo) redo.disabled = !store().canRedo();
  }

  function refresh() {
    if (!selectedId) {
      var first = store().getDraft().items[0];
      selectedId = first && first.id;
    }
    renderList();
    renderEditor();
    syncToolbar();
  }

  function patchField(name, value) {
    var item = currentItem();
    if (!item) return;
    if (name === 'renderType3D') {
      item.media3D = item.media3D || { type: 'procedural', data: '' };
      item.media3D.type = value === 'custom-glb' ? 'custom-glb' : 'procedural';
    } else if (name === 'renderType2D') {
      item.media2D = item.media2D || { type: 'default-diagram', data: '' };
      item.media2D.type = value === 'custom-media' ? 'custom-media' : 'default-diagram';
    } else if (name === 'dualGroup') {
      item.dualGroup = value === '1' || value === true;
    } else if (name === 'capacity' || name === 'tubeCount' || name === 'strandsPerTube') {
      item[name] = parseInt(value, 10) || 0;
    } else {
      item[name] = value;
    }
    store().replaceItem(item, true);
  }

  function bindModal(root) {
    root.addEventListener('click', function (e) {
      if (e.target.getAttribute('data-cms-close') != null) {
        closeModal();
        return;
      }
      var tab = e.target.getAttribute('data-cms-tab');
      if (tab) {
        activeTab = tab;
        root.querySelectorAll('[data-cms-tab]').forEach(function (btn) {
          btn.classList.toggle('is-active', btn.getAttribute('data-cms-tab') === tab);
        });
        renderEditor();
        return;
      }
      var sel = e.target.closest('[data-cms-select]');
      if (sel) {
        selectedId = sel.getAttribute('data-cms-select');
        selectedVariantId = null;
        refresh();
        return;
      }
      if (e.target.id === 'anatomy-cms-add-variant') {
        selectedVariantId = store().addVariant(selectedId);
        refresh();
        setStatus('New variant added. Save Changes to apply.');
        return;
      }
      var delVar = e.target.getAttribute('data-cms-delete-variant');
      if (delVar) {
        if (!store().deleteVariant(selectedId, delVar)) {
          setStatus('Keep at least one variant.', true);
          return;
        }
        selectedVariantId = null;
        refresh();
        setStatus('Variant deleted from draft.');
      }
    });

    root.addEventListener('change', function (e) {
      var fieldEl = e.target.getAttribute('data-cms-field') ? e.target : null;
      if (fieldEl) {
        patchField(fieldEl.getAttribute('data-cms-field'), fieldEl.value);
        if (fieldEl.getAttribute('data-cms-field') === 'label' ||
            fieldEl.getAttribute('data-cms-field') === 'sublabel' ||
            fieldEl.getAttribute('data-cms-field') === 'categoryId') {
          renderList();
        }
        syncToolbar();
      }
      var vf = e.target.getAttribute('data-cms-variant-field');
      if (vf) {
        var itemV = currentItem();
        var vid = e.target.getAttribute('data-variant-id');
        if (itemV && itemV.variants) {
          itemV.variants.forEach(function (v) {
            if (v.id !== vid) return;
            if (vf === 'label') v.label = e.target.value;
            if (vf === 'guideText') v.guideText = e.target.value;
            if (vf === 'renderType3D') {
              v.media3D = v.media3D || { type: 'procedural', data: '' };
              v.media3D.type = e.target.value === 'custom-glb' ? 'custom-glb' : 'procedural';
            }
            if (vf === 'renderType2D') {
              v.media2D = v.media2D || { type: 'default-diagram', data: '' };
              v.media2D.type = e.target.value === 'custom-media' ? 'custom-media' : 'default-diagram';
            }
          });
          store().replaceItem(itemV, true);
          syncToolbar();
        }
      }
      var upKind = e.target.getAttribute('data-variant-upload');
      if (upKind) {
        var upFile = e.target.files && e.target.files[0];
        var upId = e.target.getAttribute('data-variant-id');
        if (!upFile || !upId) return;
        var upReader = new FileReader();
        upReader.onload = function () {
          var item = currentItem();
          if (!item || !item.variants) return;
          var data = String(upReader.result || '');
          if (data.length > store().MAX_MEDIA_CHARS) {
            setStatus('File too large for browser storage.', true);
            return;
          }
          item.variants.forEach(function (v) {
            if (v.id !== upId) return;
            if (upKind === '3d') v.media3D = { type: 'custom-glb', data: data };
            else v.media2D = { type: 'custom-media', data: data };
          });
          store().replaceItem(item, true);
          setStatus('Variant media updated.');
          renderEditor();
          syncToolbar();
        };
        upReader.readAsDataURL(upFile);
      }
      if (e.target.id === 'uploadFile3D') {
        var file3d = e.target.files && e.target.files[0];
        if (!file3d) return;
        var name3d = (file3d.name || '').toLowerCase();
        if (name3d.indexOf('.glb') === -1 && name3d.indexOf('.gltf') === -1) {
          setStatus('Please upload a .glb or .gltf file for 3D View.', true);
          return;
        }
        var reader3d = new FileReader();
        reader3d.onload = function () {
          var item = currentItem();
          if (!item) return;
          var data = String(reader3d.result || '');
          if (data.length > store().MAX_MEDIA_CHARS) {
            setStatus('3D file too large for browser storage.', true);
            return;
          }
          item.media3D = { type: 'custom-glb', data: data };
          store().replaceItem(item, true);
          setStatus('3D model attached to ' + item.label);
          renderEditor();
          syncToolbar();
        };
        reader3d.readAsDataURL(file3d);
      }
      if (e.target.id === 'uploadFile2D') {
        var file2d = e.target.files && e.target.files[0];
        if (!file2d) return;
        var name2d = (file2d.name || '').toLowerCase();
        var ok2d = /\.(svg|png|jpe?g|mp4)$/i.test(name2d) ||
          (file2d.type && (file2d.type.indexOf('image/') === 0 || file2d.type.indexOf('video/') === 0));
        if (!ok2d) {
          setStatus('Please upload SVG, PNG, JPG, or MP4 for 2D Layout.', true);
          return;
        }
        var reader2d = new FileReader();
        reader2d.onload = function () {
          var item = currentItem();
          if (!item) return;
          var data = String(reader2d.result || '');
          if (data.length > store().MAX_MEDIA_CHARS) {
            setStatus('2D file too large for browser storage.', true);
            return;
          }
          item.media2D = { type: 'custom-media', data: data };
          store().replaceItem(item, true);
          setStatus('2D schematic attached to ' + item.label);
          renderEditor();
          syncToolbar();
        };
        reader2d.readAsDataURL(file2d);
      }
      if (e.target.id === 'anatomy-item-icon-input') {
        var iconFile = e.target.files && e.target.files[0];
        if (!iconFile) return;
        var iconReader = new FileReader();
        iconReader.onload = function () {
          var item = currentItem();
          if (!item) return;
          var data = String(iconReader.result || '');
          if (data.indexOf('data:image') !== 0) {
            setStatus('Please upload a PNG, JPEG, or SVG icon.', true);
            return;
          }
          if (data.length > store().MAX_MEDIA_CHARS) {
            setStatus('Icon file is too large for browser storage.', true);
            return;
          }
          item.icon = data;
          store().replaceItem(item, true);
          setStatus('Icon updated for ' + item.label);
          renderEditor();
          renderList();
          syncToolbar();
        };
        iconReader.readAsDataURL(iconFile);
      }
    });

    $('anatomy-cms-undo').addEventListener('click', function () {
      store().undo();
    });
    $('anatomy-cms-redo').addEventListener('click', function () {
      store().redo();
    });
    $('anatomy-cms-reset').addEventListener('click', function () {
      if (window.confirm('Reset all anatomy CMS data to factory defaults?')) {
        store().resetToDefaults();
        setStatus('Draft reset to factory defaults. Click Save Changes to apply.');
      }
    });
    $('anatomy-cms-save').addEventListener('click', function () {
      var ok = store().saveChanges();
      setStatus(ok ? 'Saved. Workspace will re-render.' : 'Save failed (storage quota).', !ok);
    });

    root.addEventListener('click', function (e) {
      if (e.target.id === 'anatomy-cms-add-cable') {
        selectedId = store().addItem('cable');
        refresh();
        setStatus('New cable variation added.');
      }
      if (e.target.id === 'anatomy-cms-add-comp') {
        selectedId = store().addItem('component');
        refresh();
        setStatus('New component added.');
      }
      if (e.target.id === 'anatomy-cms-delete') {
        if (!selectedId) return;
        if (!window.confirm('Delete this item?')) return;
        var ok = store().deleteItem(selectedId);
        if (!ok) {
          setStatus('Keep at least one cable item.', true);
          return;
        }
        selectedId = store().getDraft().items[0].id;
        refresh();
        setStatus('Item deleted from draft. Save to apply.');
      }
    });
  }

  function canShowSimulatorAdminSettingsUI() {
    if (window.IFAAuth && typeof window.IFAAuth.canShowSimulatorAdminSettingsUI === 'function') {
      return window.IFAAuth.canShowSimulatorAdminSettingsUI();
    }
    return false;
  }

  function syncAdminSettingsButton() {
    var btn = document.getElementById('anatomy-admin-settings-btn');
    if (!btn) return;
    var show = canShowSimulatorAdminSettingsUI();
    btn.hidden = !show;
    btn.style.display = show ? 'inline-flex' : 'none';
    btn.classList.toggle('is-admin-visible', show);
  }

  function openModal() {
    if (!canShowSimulatorAdminSettingsUI() || !store()) return;
    ensureModal();
    modalOpen = true;
    var modal = $('anatomy-cms-modal');
    modal.hidden = false;
    store().discardDraft();
    selectedId = store().getDraft().items[0] && store().getDraft().items[0].id;
    selectedVariantId = null;
    refresh();
    setStatus('');
  }

  function closeModal() {
    modalOpen = false;
    var modal = $('anatomy-cms-modal');
    if (modal) modal.hidden = true;
    if (store()) store().discardDraft();
  }

  function onKey(e) {
    if (!modalOpen) return;
    var key = (e.key || '').toLowerCase();
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) {
      if (key === 'escape') closeModal();
      return;
    }
    if (key === 'z' && e.shiftKey) {
      e.preventDefault();
      store().redo();
      return;
    }
    if (key === 'z') {
      e.preventDefault();
      store().undo();
      return;
    }
    if (key === 'y') {
      e.preventDefault();
      store().redo();
    }
  }

  function bindAdminSettingsUiAuthListener() {
    if (window.__ifaAnatomyCmsAdminSettingsAuthListenerBound) return;
    if (!window.IFAAuth || typeof window.IFAAuth.onAuthChange !== 'function') {
      window.setTimeout(bindAdminSettingsUiAuthListener, 50);
      return;
    }
    window.__ifaAnatomyCmsAdminSettingsAuthListenerBound = true;
    window.IFAAuth.onAuthChange(function () {
      syncAdminSettingsButton();
    });
  }

  function bind() {
    syncAdminSettingsButton();
    bindAdminSettingsUiAuthListener();
    var btn = document.getElementById('anatomy-admin-settings-btn');
    if (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        openModal();
      });
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('ifa:anatomy-draft-changed', function () {
      if (modalOpen) refresh();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
