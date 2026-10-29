/**
 * Application menu bar — File operations and project persistence (localStorage).
 */
(function (global) {
  'use strict';

  var DEBUG = !!(global && global.FTTH_DEBUG);

  var INDEX_KEY = 'ftth_project_index_v1';
  var MAX_RECENT = 8;

  var fileInputEl = null;
  var menuBound = false;

  function io() {
    return global.FTTHProjectIO || null;
  }

  function slugName(name) {
    return String(name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'project';
  }

  function projectDataKey(name) {
    return 'ftth_project_data_v1_' + slugName(name);
  }

  function readIndex() {
    try {
      var raw = localStorage.getItem(INDEX_KEY);
      if (!raw) return { current: null, recent: [], projects: {} };
      var data = JSON.parse(raw);
      if (!data || typeof data !== 'object') return { current: null, recent: [], projects: {} };
      if (!Array.isArray(data.recent)) data.recent = [];
      if (!data.projects) data.projects = {};
      return data;
    } catch (err) {
      return { current: null, recent: [], projects: {} };
    }
  }

  function writeIndex(index) {
    try {
      localStorage.setItem(INDEX_KEY, JSON.stringify(index));
      return true;
    } catch (err) {
      console.error('[FileMenu] Index save failed:', err);
      return false;
    }
  }

  function touchRecent(index, name) {
    index.recent = (index.recent || []).filter(function (n) { return n !== name; });
    index.recent.unshift(name);
    if (index.recent.length > MAX_RECENT) index.recent.length = MAX_RECENT;
    index.current = name;
    index.projects[name] = {
      savedAt: new Date().toISOString(),
    };
  }

  function updateSaveStatus(text) {
    var el = document.getElementById('save-status');
    if (!el) return;
    el.textContent = text;
    el.classList.add('save-status--flash');
    setTimeout(function () { el.classList.remove('save-status--flash'); }, 1200);
  }

  function refreshProjectLabel() {
    var el = document.getElementById('app-menu-project-name');
    if (!el) return;
    var name = io()?.getCurrentProjectName?.();
    el.textContent = name ? name : 'Untitled Project';
    el.title = name ? ('Current project: ' + name) : 'No project name saved yet';
  }

  function saveProjectByName(name, showToast) {
    var projectIO = io();
    if (!projectIO || !name) return false;
    var payload = projectIO.serializeProjectState();
    payload.projectName = name;
    try {
      localStorage.setItem(projectDataKey(name), JSON.stringify(payload));
      var index = readIndex();
      touchRecent(index, name);
      writeIndex(index);
      projectIO.setCurrentProjectName(name);
      updateSaveStatus('Saved');
      if (showToast) showMenuToast('Saved "' + name + '"');
      renderRecentMenuItems();
      return true;
    } catch (err) {
      console.error('[FileMenu] Save failed:', err);
      alert('Save failed — storage may be full or blocked.');
      return false;
    }
  }

  function loadProjectByName(name) {
    var projectIO = io();
    if (!projectIO || !name) return false;
    try {
      var raw = localStorage.getItem(projectDataKey(name));
      if (!raw) {
        alert('Project not found: ' + name);
        return false;
      }
      var payload = JSON.parse(raw);
      if (!projectIO.restoreProjectState(payload)) {
        alert('Could not load project: ' + name);
        return false;
      }
      var index = readIndex();
      touchRecent(index, name);
      writeIndex(index);
      projectIO.setCurrentProjectName(name);
      updateSaveStatus('Opened');
      showMenuToast('Opened "' + name + '"');
      renderRecentMenuItems();
      return true;
    } catch (err) {
      console.error('[FileMenu] Load failed:', err);
      alert('Failed to load project.');
      return false;
    }
  }

  function fileNew() {
    if (!confirm('Create a new project? Unsaved changes will be lost.')) return;
    io()?.clearWorkspace?.();
    io()?.setCurrentProjectName?.(null);
    updateSaveStatus('New');
    showMenuToast('New project');
    refreshProjectLabel();
  }

  function fileOpenPicker() {
    if (!fileInputEl) {
      fileInputEl = document.createElement('input');
      fileInputEl.type = 'file';
      fileInputEl.accept = '.json,application/json';
      fileInputEl.style.display = 'none';
      fileInputEl.addEventListener('change', function () {
        var file = fileInputEl.files && fileInputEl.files[0];
        fileInputEl.value = '';
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          try {
            var payload = JSON.parse(String(reader.result || ''));
            var projectIO = io();
            if (!projectIO?.restoreProjectState?.(payload)) {
              alert('Invalid project file.');
              return;
            }
            var name = payload.projectName || file.name.replace(/\.json$/i, '') || 'Imported Project';
            saveProjectByName(name, false);
            showMenuToast('Imported "' + name + '"');
          } catch (err) {
            alert('Could not read project file.');
          }
        };
        reader.readAsText(file);
      });
      document.body.appendChild(fileInputEl);
    }
    fileInputEl.click();
  }

  function fileSave() {
    var name = io()?.getCurrentProjectName?.();
    if (!name) {
      fileSaveAs();
      return;
    }
    saveProjectByName(name, true);
  }

  function fileSaveAs() {
    var suggested = io()?.getCurrentProjectName?.() || 'Untitled Project';
    var name = window.prompt('Save project as:', suggested);
    if (!name || !String(name).trim()) return;
    saveProjectByName(String(name).trim(), true);
  }

  function fileClose() {
    if (!confirm('Close the current project? Unsaved changes will be lost.')) return;
    io()?.clearWorkspace?.();
    io()?.setCurrentProjectName?.(null);
    updateSaveStatus('Closed');
    showMenuToast('Project closed');
    refreshProjectLabel();
    if (global.FTTHStartupView?.returnToStartup) global.FTTHStartupView.returnToStartup();
  }

  function getRecentProjects(limit) {
    var max = typeof limit === 'number' && limit > 0 ? limit : MAX_RECENT;
    var index = readIndex();
    var names = (index.recent || []).slice(0, max);
    return names.map(function (name) {
      var meta = (index.projects && index.projects[name]) || {};
      return { name: name, savedAt: meta.savedAt || null };
    });
  }

  function removeRecentProject(name) {
    if (!name) return false;
    var index = readIndex();
    var recent = index.recent || [];
    if (recent.indexOf(name) === -1) return false;
    index.recent = recent.filter(function (n) { return n !== name; });
    if (index.projects && index.projects[name]) delete index.projects[name];
    if (index.current === name) index.current = null;
    writeIndex(index);
    try {
      localStorage.removeItem(projectDataKey(name));
    } catch (err) { /* ignore */ }
    renderRecentMenuItems();
    return true;
  }

  function createNewEmptyProject() {
    var projectIO = io();
    if (!projectIO) return false;
    projectIO.clearWorkspace();
    var name = 'Untitled Project';
    var base = name;
    var n = 1;
    while (localStorage.getItem(projectDataKey(name))) {
      name = base + ' ' + (++n);
    }
    if (!saveProjectByName(name, false)) return false;
    updateSaveStatus('New');
    showMenuToast('New project "' + name + '"');
    if (global.FTTHStartupView?.refreshRecentProjects) global.FTTHStartupView.refreshRecentProjects();
    return true;
  }

  function showMenuToast(text) {
    var old = document.getElementById('file-menu-toast');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var t = document.createElement('div');
    t.id = 'file-menu-toast';
    t.className = 'file-menu-toast';
    t.setAttribute('role', 'status');
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(function () {
      if (t.parentNode) t.parentNode.removeChild(t);
    }, 1800);
  }

  function renderRecentMenuItems() {
    var list = document.getElementById('file-menu-recent-list');
    if (!list) return;
    list.innerHTML = '';
    var index = readIndex();
    var recent = index.recent || [];
    if (!recent.length) {
      var empty = document.createElement('li');
      empty.className = 'app-menu-bar__empty';
      empty.textContent = 'No recent projects';
      list.appendChild(empty);
      return;
    }
    recent.forEach(function (name) {
      var li = document.createElement('li');
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-menu-bar__menu-item app-menu-bar__menu-item--recent';
      btn.setAttribute('role', 'menuitem');
      btn.textContent = name;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        loadProjectByName(name);
      });
      li.appendChild(btn);
      list.appendChild(li);
    });
  }

  function closeAllMenus() {
    document.querySelectorAll('.app-menu-bar__item--open').forEach(function (item) {
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

  function handleFileShortcut(e) {
    if (!e || e.repeat || isEditableTarget(e)) return false;
    var mod = e.ctrlKey || e.metaKey;
    if (!mod) return false;
    var key = e.key.toLowerCase();

    if (key === 'n') {
      e.preventDefault();
      e.stopPropagation();
      fileNew();
      return true;
    }
    if (key === 'o') {
      e.preventDefault();
      e.stopPropagation();
      fileOpenPicker();
      return true;
    }
    if (key === 's' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      fileSaveAs();
      return true;
    }
    if (key === 's' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      fileSave();
      return true;
    }
    return false;
  }

  function bindMenuActions() {
    if (menuBound) return;
    menuBound = true;

    document.querySelectorAll('[data-file-action]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeAllMenus();
        var action = btn.dataset.fileAction;
        if (action === 'new') fileNew();
        else if (action === 'open') fileOpenPicker();
        else if (action === 'save') fileSave();
        else if (action === 'save-as') fileSaveAs();
        else if (action === 'close') fileClose();
      });
    });

    document.querySelectorAll('.app-menu-bar__item[data-menu]').forEach(function (item) {
      var trigger = item.querySelector('.app-menu-bar__trigger');
      if (!trigger) return;
      trigger.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleMenu(item);
      });
    });

    document.addEventListener('click', function () {
      closeAllMenus();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAllMenus();
      handleFileShortcut(e);
    }, true);

    var btnSave = document.getElementById('btn-save-design');
    var btnLoad = document.getElementById('btn-load-design');
    if (btnSave) btnSave.addEventListener('click', function () { fileSave(); });
    if (btnLoad) btnLoad.addEventListener('click', function () {
      var index = readIndex();
      if (index.current) loadProjectByName(index.current);
      else fileOpenPicker();
    });
  }

  function tryRestoreCurrentProject() {
    var index = readIndex();
    if (!index.current) return;
    var projectIO = io();
    if (!projectIO) return;
    try {
      var raw = localStorage.getItem(projectDataKey(index.current));
      if (!raw) return;
      var payload = JSON.parse(raw);
      if (!projectIO.restoreProjectState(payload)) return;
      projectIO.setCurrentProjectName(index.current);
      updateSaveStatus('Restored');
      refreshProjectLabel();
    } catch (err) {
      if (DEBUG) {
      console.warn('[FileMenu] Auto-restore skipped:', err);
      }
    }
  }

  function init() {
    if (!document.getElementById('app-menu-bar')) return;
    bindMenuActions();
    refreshProjectLabel();
    renderRecentMenuItems();
    if (!document.getElementById('startup-view')) {
      tryRestoreCurrentProject();
    }
  }

  global.FTTHFileMenu = {
    init: init,
    refreshProjectLabel: refreshProjectLabel,
    fileNew: fileNew,
    fileOpen: fileOpenPicker,
    fileSave: fileSave,
    fileSaveAs: fileSaveAs,
    fileClose: fileClose,
    getRecentProjects: getRecentProjects,
    removeRecentProject: removeRecentProject,
    loadProjectByName: loadProjectByName,
    createNewEmptyProject: createNewEmptyProject,
  };
})(typeof window !== 'undefined' ? window : globalThis);
