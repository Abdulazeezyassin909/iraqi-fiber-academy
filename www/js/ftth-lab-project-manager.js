/**
 * Workspace project manager — landing screen, File menu, localStorage projects.
 * FTTH Lab key: ifa_ftth_lab_projects
 * Optical Power Meter key: ifa_opm_projects
 */
(function (global) {
  'use strict';

  function createWorkspaceProjectManager(cfg) {
  var STORAGE_KEY = cfg.storageKey;
  var MAX_RECENT = 20;
  var KIND = cfg.kind;
  var IDS = cfg.ids;
  var PAGE_CLASS = cfg.pageClass;

  var menuBound = false;
  var workspaceOpen = false;
  var overlayMode = false;

  function lab() {
    return global.FtthLab || null;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function emptyStore() {
    return { version: 1, current: null, recent: [], projects: {} };
  }

  function readStore() {
    try {
      var raw = global.localStorage.getItem(STORAGE_KEY);
      if (!raw) return emptyStore();
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return emptyStore();
      if (!data.projects || typeof data.projects !== 'object') data.projects = {};
      if (!Array.isArray(data.recent)) data.recent = [];
      data.recent = data.recent.filter(function (id) { return !!data.projects[id]; });
      if (data.current && !data.projects[data.current]) data.current = null;
      return data;
    } catch (err) {
      return emptyStore();
    }
  }

  function writeStore(store) {
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (err) {
      alert('Save failed — browser storage may be full or blocked.');
      return false;
    }
  }

  function uid() {
    return (cfg.idPrefix || 'proj') + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function formatSavedAt(iso) {
    if (!iso) return '';
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch (err) {
      return '';
    }
  }

  function nextUntitledName(store) {
    var used = {};
    Object.keys(store.projects || {}).forEach(function (id) {
      var n = store.projects[id] && store.projects[id].name;
      if (n) used[n] = true;
    });
    var i = 1;
    var name = 'Untitled Project ' + i;
    while (used[name]) {
      i += 1;
      name = 'Untitled Project ' + i;
    }
    return name;
  }

  function touchRecent(store, id) {
    store.recent = (store.recent || []).filter(function (x) { return x !== id; });
    store.recent.unshift(id);
    if (store.recent.length > MAX_RECENT) store.recent.length = MAX_RECENT;
    store.current = id;
  }

  function listRecent(limit) {
    var store = readStore();
    var max = typeof limit === 'number' && limit > 0 ? limit : MAX_RECENT;
    var out = [];
    (store.recent || []).forEach(function (id) {
      var p = store.projects[id];
      if (!p) return;
      out.push({
        id: id,
        name: p.name,
        createdAt: p.createdAt,
        modifiedAt: p.modifiedAt,
      });
    });
    return out.slice(0, max);
  }

  function updateSaveStatus(text) {
    var el = $(IDS.saveStatus);
    if (!el) return;
    el.textContent = text || '—';
    el.classList.add('save-status--flash');
    setTimeout(function () { el.classList.remove('save-status--flash'); }, 1200);
  }

  function refreshProjectLabel() {
    var el = $(IDS.projectName);
    if (!el) return;
    var name = lab() && lab().getCurrentProjectName ? lab().getCurrentProjectName() : null;
    el.textContent = name || 'Untitled Project';
    el.title = name ? ('Current project: ' + name) : 'No project name yet';
  }

  function showToast(text) {
    var old = $(IDS.toast);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = IDS.toast;
    t.className = 'file-menu-toast lab-file-menu-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 1800);
  }

  function persistProject(id, name, payload) {
    var store = readStore();
    var now = new Date().toISOString();
    var existing = store.projects[id];
    store.projects[id] = {
      id: id,
      name: name,
      createdAt: existing && existing.createdAt ? existing.createdAt : now,
      modifiedAt: now,
      payload: payload,
    };
    touchRecent(store, id);
    if (!writeStore(store)) return false;
    if (lab()) {
      if (lab().setCurrentProjectName) lab().setCurrentProjectName(name);
      if (lab().setCurrentProjectId) lab().setCurrentProjectId(id);
    }
    refreshProjectLabel();
    renderRecentMenuItems();
    renderRecentLanding();
    return true;
  }

  function collectPayload() {
    if (!lab() || typeof lab().serializeProjectState !== 'function') return null;
    var payload = lab().serializeProjectState();
    payload.kind = KIND;
    if (typeof cfg.exportExtras === 'function') {
      try { payload.extras = cfg.exportExtras(); } catch (err) { /* ignore */ }
    }
    return payload;
  }

  function saveCurrent(showMsg) {
    if (!lab()) return false;
    var id = lab().getCurrentProjectId && lab().getCurrentProjectId();
    var name = lab().getCurrentProjectName && lab().getCurrentProjectName();
    var store = readStore();
    if (!id || !store.projects[id]) {
      return saveAs(null, true);
    }
    if (!name) name = store.projects[id].name || nextUntitledName(store);
    var payload = collectPayload();
    if (!payload) return false;
    payload.projectName = name;
    payload.projectId = id;
    if (!persistProject(id, name, payload)) return false;
    updateSaveStatus('Saved');
    if (showMsg) showToast('Saved "' + name + '"');
    if (lab().setStatus) lab().setStatus('Project saved', true);
    return true;
  }

  function saveAs(suggested, autoUntitled) {
    if (!lab()) return false;
    var store = readStore();
    var currentName = lab().getCurrentProjectName && lab().getCurrentProjectName();
    var name;
    if (autoUntitled && !suggested) {
      name = nextUntitledName(store);
    } else {
      name = window.prompt('Save project as:', suggested || currentName || nextUntitledName(store));
      if (!name || !String(name).trim()) return false;
      name = String(name).trim();
    }
    var id = uid();
    var payload = collectPayload();
    if (!payload) return false;
    payload.projectName = name;
    payload.projectId = id;
    if (!persistProject(id, name, payload)) return false;
    updateSaveStatus('Saved');
    showToast('Saved "' + name + '"');
    if (lab().setStatus) lab().setStatus('Project saved as "' + name + '"', true);
    return true;
  }

  function loadProject(id) {
    if (!id) return false;
    if (!lab() || typeof lab().restoreProjectState !== 'function') {
      alert('Workspace is still loading. Please try again in a moment.');
      return false;
    }
    var store = readStore();
    var entry = store.projects[id];
    if (!entry || !entry.payload) {
      alert('Project not found.');
      deleteProject(id);
      return false;
    }
    if (!lab().restoreProjectState(clone(entry.payload))) {
      alert('Could not load project.');
      return false;
    }
    if (typeof cfg.importExtras === 'function') {
      try { cfg.importExtras(entry.payload.extras || null); } catch (err) { /* ignore */ }
    }
    touchRecent(store, id);
    writeStore(store);
    if (lab().setCurrentProjectName) lab().setCurrentProjectName(entry.name);
    if (lab().setCurrentProjectId) lab().setCurrentProjectId(id);
    refreshProjectLabel();
    renderRecentMenuItems();
    updateSaveStatus('Opened');
    showToast('Opened "' + entry.name + '"');
    setWorkspaceVisible(true);
    return true;
  }

  function deleteProject(id) {
    if (!id) return false;
    var store = readStore();
    if (!store.projects[id]) return false;
    delete store.projects[id];
    store.recent = (store.recent || []).filter(function (x) { return x !== id; });
    if (store.current === id) store.current = null;
    if (lab() && lab().getCurrentProjectId && lab().getCurrentProjectId() === id) {
      if (lab().setCurrentProjectId) lab().setCurrentProjectId(null);
      if (lab().setCurrentProjectName) lab().setCurrentProjectName(null);
      refreshProjectLabel();
    }
    writeStore(store);
    renderRecentMenuItems();
    renderRecentLanding();
    return true;
  }

  function fileNew() {
    if (workspaceOpen && !confirm('Create a new project? Unsaved changes will be lost.')) return;
    if (lab() && lab().clearWorkspace) lab().clearWorkspace();
    if (typeof cfg.resetExtras === 'function') {
      try { cfg.resetExtras(); } catch (err) { /* ignore */ }
    }
    if (lab() && lab().setCurrentProjectId) lab().setCurrentProjectId(null);
    if (lab() && lab().setCurrentProjectName) lab().setCurrentProjectName(null);
    var store = readStore();
    var name = nextUntitledName(store);
    var id = uid();
    var payload = collectPayload() || { version: 1, kind: KIND, tools: {} };
    payload.projectName = name;
    payload.projectId = id;
    persistProject(id, name, payload);
    updateSaveStatus('New');
    showToast('New project "' + name + '"');
    if (lab() && typeof lab().centerWorldInView === 'function') {
      try { lab().centerWorldInView(); } catch (err) { /* ignore */ }
    }
    setWorkspaceVisible(true);
  }

  function fileOpen() {
    overlayMode = workspaceOpen;
    showLanding(overlayMode);
  }

  function fileClose() {
    if (workspaceOpen && !confirm('Close the current project? Unsaved changes will be lost.')) return;
    if (lab() && lab().clearWorkspace) lab().clearWorkspace();
    if (typeof cfg.resetExtras === 'function') {
      try { cfg.resetExtras(); } catch (err) { /* ignore */ }
    }
    if (lab() && lab().setCurrentProjectId) lab().setCurrentProjectId(null);
    if (lab() && lab().setCurrentProjectName) lab().setCurrentProjectName(null);
    var store = readStore();
    store.current = null;
    writeStore(store);
    refreshProjectLabel();
    updateSaveStatus('Closed');
    showToast('Project closed');
    overlayMode = false;
    showLanding(false);
  }

  function setWorkspaceVisible(loaded) {
    workspaceOpen = !!loaded;
    var startup = $(IDS.startup);
    var app = $(IDS.workspace);
    if (startup) {
      startup.hidden = loaded;
      startup.classList.toggle('is-overlay', false);
      startup.setAttribute('aria-hidden', loaded ? 'true' : 'false');
    }
    if (app) {
      app.hidden = !loaded;
      app.setAttribute('aria-hidden', loaded ? 'false' : 'true');
    }
    overlayMode = false;
    var back = $(IDS.back);
    if (back) back.hidden = true;
    if (loaded && lab() && typeof lab().centerWorldInView === 'function' && !lab().getCurrentProjectId()) {
      try { lab().centerWorldInView(); } catch (err) { /* ignore */ }
    }
  }

  function showLanding(asOverlay) {
    var startup = $(IDS.startup);
    var app = $(IDS.workspace);
    if (!startup) return;
    overlayMode = !!asOverlay;
    startup.hidden = false;
    startup.classList.toggle('is-overlay', overlayMode);
    startup.setAttribute('aria-hidden', 'false');
    var back = $(IDS.back);
    if (back) back.hidden = !overlayMode;
    if (!overlayMode && app) {
      app.hidden = true;
      app.setAttribute('aria-hidden', 'true');
      workspaceOpen = false;
    }
    renderRecentLanding();
  }

  function renderRecentLanding() {
    var list = $(IDS.recentList);
    if (!list) return;
    list.innerHTML = '';
    var recent = listRecent(MAX_RECENT);
    if (!recent.length) {
      var empty = document.createElement('li');
      empty.className = 'startup-view__empty';
      empty.textContent = 'No recent projects yet — create one from a template.';
      list.appendChild(empty);
      return;
    }
    recent.forEach(function (entry) {
      var li = document.createElement('li');
      li.className = 'startup-view__recent-item';

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'startup-view__recent-btn';
      btn.setAttribute('aria-label', 'Open project ' + entry.name);

      var nameEl = document.createElement('span');
      nameEl.className = 'startup-view__recent-name';
      nameEl.textContent = entry.name;

      var metaEl = document.createElement('span');
      metaEl.className = 'startup-view__recent-meta';
      metaEl.textContent = formatSavedAt(entry.modifiedAt || entry.createdAt) || 'Not saved yet';

      btn.appendChild(nameEl);
      btn.appendChild(metaEl);
      btn.addEventListener('click', function () {
        loadProject(entry.id);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'startup-view__recent-delete';
      delBtn.setAttribute('aria-label', 'Remove ' + entry.name + ' from recent projects');
      delBtn.textContent = '\u00d7';
      delBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!confirm('Delete project "' + entry.name + '"?')) return;
        deleteProject(entry.id);
      });

      li.appendChild(btn);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  function renderTemplates() {
    var grid = $(IDS.templates);
    if (!grid) return;
    grid.innerHTML = '';
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'startup-view__template-card';
    card.setAttribute('aria-label', 'Create new empty project');

    var icon = document.createElement('span');
    icon.className = 'startup-view__template-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '+';

    var title = document.createElement('span');
    title.className = 'startup-view__template-title';
    title.textContent = 'New Empty Project';

    var desc = document.createElement('span');
    desc.className = 'startup-view__template-desc';
    desc.textContent = cfg.templateDesc || 'Blank canvas';

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.addEventListener('click', fileNew);
    grid.appendChild(card);
  }

  function renderRecentMenuItems() {
    var list = $(IDS.recentMenu);
    if (!list) return;
    list.innerHTML = '';
    var recent = listRecent(8);
    if (!recent.length) {
      var empty = document.createElement('li');
      empty.className = 'app-menu-bar__empty';
      empty.textContent = 'No recent projects';
      list.appendChild(empty);
      return;
    }
    recent.forEach(function (entry) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-menu-bar__menu-item app-menu-bar__menu-item--recent';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = entry.name;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        loadProject(entry.id);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function closeAllMenus() {
    document.querySelectorAll('#' + IDS.menuBar + ' .app-menu-bar__item--open').forEach(function (item) {
      item.classList.remove('app-menu-bar__item--open');
      var trigger = item.querySelector('.app-menu-bar__trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(item) {
    var isOpen = item.classList.contains('app-menu-bar__item--open');
    closeAllMenus();
    if (!isOpen) {
      item.classList.add('app-menu-bar__item--open');
      var trigger = item.querySelector('.app-menu-bar__trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'true');
      if (item.dataset.menu === 'file') renderRecentMenuItems();
    }
  }

  function isEditableTarget(e) {
    var t = e.target;
    if (!t) return false;
    if (t.isContentEditable) return true;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function settingsModalOpen() {
    var modal = $(IDS.settingsModal);
    return !!(modal && !modal.hidden);
  }

  function handleFileShortcut(e) {
    if (!e || e.repeat || isEditableTarget(e) || settingsModalOpen()) return false;
    if (!document.body.classList.contains(PAGE_CLASS)) return false;
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;
    var key = (e.key || '').toLowerCase();
    if (key === 'n') {
      e.preventDefault();
      e.stopPropagation();
      fileNew();
      return true;
    }
    if (key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      fileOpen();
      return true;
    }
    if (key === 's' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      saveAs();
      return true;
    }
    if (key === 's' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      saveCurrent(true);
      return true;
    }
    return false;
  }

  function bindMenu() {
    if (menuBound) return;
    menuBound = true;

    document.querySelectorAll('#' + IDS.menuBar + ' [data-file-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        var action = btn.getAttribute('data-file-action');
        if (action === 'new') fileNew();
        else if (action === 'open') fileOpen();
        else if (action === 'save') saveCurrent(true);
        else if (action === 'save-as') saveAs();
        else if (action === 'close') fileClose();
      });
    });

    document.querySelectorAll('#' + IDS.menuBar + ' .app-menu-bar__item[data-menu]').forEach(function (item) {
      var trigger = item.querySelector('.app-menu-bar__trigger');
      if (!trigger || trigger.disabled) return;
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(item);
      });
    });

    document.addEventListener('click', function () { closeAllMenus(); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllMenus();
      handleFileShortcut(e);
    }, true);

    var back = $(IDS.back);
    if (back) {
      back.addEventListener('click', function () {
        setWorkspaceVisible(true);
      });
    }
  }

  function init() {
    if (!$(IDS.startup) || !$(IDS.workspace)) return;
    bindMenu();
    renderTemplates();
    renderRecentLanding();
    renderRecentMenuItems();
    refreshProjectLabel();
    overlayMode = false;
    showLanding(false);
  }

  init();

  return {
    fileNew: fileNew,
    fileOpen: fileOpen,
    fileSave: function () { return saveCurrent(true); },
    fileSaveAs: saveAs,
    fileClose: fileClose,
    loadProject: loadProject,
    getRecentProjects: listRecent,
    STORAGE_KEY: STORAGE_KEY,
  };
  }

  function boot() {
    if (document.getElementById('lab-startup-view') && document.body.classList.contains('otdr-lab-page')) {
      global.FtthLabProjectManager = createWorkspaceProjectManager({
        storageKey: 'ifa_otdr_lab_projects',
        kind: 'ifa-otdr-lab-project',
        idPrefix: 'otdr',
        pageClass: 'otdr-lab-page',
        templateDesc: 'Blank canvas · OLT · Splitters · Jumpers · Fusion · OTDR test bench',
        ids: {
          startup: 'lab-startup-view',
          back: 'lab-startup-back',
          recentList: 'lab-startup-recent-list',
          templates: 'lab-startup-templates-grid',
          workspace: 'lab-app',
          menuBar: 'lab-app-menu-bar',
          recentMenu: 'lab-file-menu-recent-list',
          saveStatus: 'lab-save-status',
          projectName: 'lab-menu-project-name',
          settingsModal: 'otdr-settings-modal',
          toast: 'lab-file-menu-toast',
        },
      });
    } else if (
      document.getElementById('lab-startup-view') &&
      document.body.classList.contains('splicer-lab-page')
    ) {
      global.FtthLabProjectManager = createWorkspaceProjectManager({
        storageKey: 'ifa_ftth_lab_projects',
        kind: 'ifa-ftth-lab-project',
        idPrefix: 'lab',
        pageClass: 'splicer-lab-page',
        templateDesc: 'Blank canvas · Fusion splicer · Cleaver · Stripper · Sleeve',
        ids: {
          startup: 'lab-startup-view',
          back: 'lab-startup-back',
          recentList: 'lab-startup-recent-list',
          templates: 'lab-startup-templates-grid',
          workspace: 'lab-app',
          menuBar: 'lab-app-menu-bar',
          recentMenu: 'lab-file-menu-recent-list',
          saveStatus: 'lab-save-status',
          projectName: 'lab-menu-project-name',
          settingsModal: 'splicer-settings-modal',
          toast: 'lab-file-menu-toast',
        },
      });
    } else if (document.getElementById('lab-startup-view')) {
      global.FtthLabProjectManager = createWorkspaceProjectManager({
        storageKey: 'ifa_ftth_lab_projects',
        kind: 'ifa-ftth-lab-project',
        idPrefix: 'lab',
        pageClass: 'lab-page',
        templateDesc: 'Blank canvas · OLT · Splitters · Jumpers · Test equipment',
        ids: {
          startup: 'lab-startup-view',
          back: 'lab-startup-back',
          recentList: 'lab-startup-recent-list',
          templates: 'lab-startup-templates-grid',
          workspace: 'lab-app',
          menuBar: 'lab-app-menu-bar',
          recentMenu: 'lab-file-menu-recent-list',
          saveStatus: 'lab-save-status',
          projectName: 'lab-menu-project-name',
          settingsModal: 'ftth-lab-settings-modal',
          toast: 'lab-file-menu-toast',
        },
      });
    }
    if (document.getElementById('opm-startup-view')) {
      global.OpmProjectManager = createWorkspaceProjectManager({
        storageKey: 'ifa_opm_projects',
        kind: 'ifa-opm-project',
        idPrefix: 'opm',
        pageClass: 'opm-page',
        templateDesc: 'Blank bench · OLS-35 · OLP-38 · Patch · Spool · Coupler',
        ids: {
          startup: 'opm-startup-view',
          back: 'opm-startup-back',
          recentList: 'opm-startup-recent-list',
          templates: 'opm-startup-templates-grid',
          workspace: 'opm-app',
          menuBar: 'opm-app-menu-bar',
          recentMenu: 'opm-file-menu-recent-list',
          saveStatus: 'opm-save-status',
          projectName: 'opm-menu-project-name',
          settingsModal: 'opm-settings-modal',
          toast: 'opm-file-menu-toast',
        },
        exportExtras: function () {
          return global.PowerMeterTrainer && typeof PowerMeterTrainer.exportProjectState === 'function'
            ? PowerMeterTrainer.exportProjectState()
            : null;
        },
        importExtras: function (extras) {
          if (global.PowerMeterTrainer && typeof PowerMeterTrainer.importProjectState === 'function') {
            PowerMeterTrainer.importProjectState(extras);
          }
        },
        resetExtras: function () {
          if (global.PowerMeterTrainer && typeof PowerMeterTrainer.resetProjectState === 'function') {
            PowerMeterTrainer.resetProjectState();
          }
        },
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : globalThis);
