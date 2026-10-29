/**
 * Startup / Welcome screen — gatekeeper before the map workspace loads.
 */
(function (global) {
  'use strict';

  var isProjectLoaded = false;
  var MAX_RECENT_DISPLAY = 10;

  function getStartupEl() {
    return document.getElementById('startup-view');
  }

  function getWorkspaceEl() {
    return document.getElementById('app-shell') || document.getElementById('app-workspace');
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

  function renderRecentProjects() {
    var list = document.getElementById('startup-recent-list');
    if (!list) return;

    var recent = global.FTTHFileMenu?.getRecentProjects?.(MAX_RECENT_DISPLAY) || [];
    list.innerHTML = '';

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
      metaEl.textContent = entry.savedAt ? formatSavedAt(entry.savedAt) : 'Not saved yet';

      btn.appendChild(nameEl);
      btn.appendChild(metaEl);
      btn.addEventListener('click', function () {
        loadRecentProject(entry.name);
      });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'startup-view__recent-delete';
      delBtn.setAttribute('aria-label', 'Remove ' + entry.name + ' from recent projects');
      delBtn.textContent = '\u00d7';
      delBtn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        global.FTTHFileMenu?.removeRecentProject?.(entry.name);
        renderRecentProjects();
      });

      li.appendChild(btn);
      li.appendChild(delBtn);
      list.appendChild(li);
    });
  }

  function renderTemplates() {
    var grid = document.getElementById('startup-templates-grid');
    if (!grid) return;

    grid.innerHTML = '';

    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'startup-view__template-card';
    card.setAttribute('aria-label', 'Create new empty project (EPSG:4326)');

    var icon = document.createElement('span');
    icon.className = 'startup-view__template-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = '＋';

    var title = document.createElement('span');
    title.className = 'startup-view__template-title';
    title.textContent = 'New Empty Project';

    var desc = document.createElement('span');
    desc.className = 'startup-view__template-desc';
    desc.textContent = 'EPSG:4326 · WGS 84 geographic coordinates';

    card.appendChild(icon);
    card.appendChild(title);
    card.appendChild(desc);
    card.addEventListener('click', beginNewEmptyProjectSetup);

    grid.appendChild(card);

    var uploadCard = document.createElement('button');
    uploadCard.type = 'button';
    uploadCard.className = 'startup-view__template-card startup-view__template-card--upload';
    uploadCard.setAttribute('aria-label', 'Upload your map image (2D canvas grid)');

    var uploadIcon = document.createElement('span');
    uploadIcon.className = 'startup-view__template-icon';
    uploadIcon.setAttribute('aria-hidden', 'true');
    uploadIcon.textContent = '🗺️';

    var uploadTitle = document.createElement('span');
    uploadTitle.className = 'startup-view__template-title';
    uploadTitle.textContent = 'Upload Your Map';

    var uploadDesc = document.createElement('span');
    uploadDesc.className = 'startup-view__template-desc';
    uploadDesc.textContent = 'Hand-drawn or scanned map · 2D grid overlay · no EPSG';

    uploadCard.appendChild(uploadIcon);
    uploadCard.appendChild(uploadTitle);
    uploadCard.appendChild(uploadDesc);
    uploadCard.addEventListener('click', function () {
      if (global.FTTHImageMapProject?.openImageFilePicker) {
        global.FTTHImageMapProject.openImageFilePicker();
      }
    });

    grid.appendChild(uploadCard);
  }

  function setProjectLoaded(loaded, opts) {
    isProjectLoaded = !!loaded;
    var startup = getStartupEl();
    var workspace = getWorkspaceEl();

    if (startup) {
      startup.hidden = loaded;
      startup.setAttribute('aria-hidden', loaded ? 'true' : 'false');
    }
    if (workspace) {
      workspace.hidden = !loaded;
      workspace.setAttribute('aria-hidden', loaded ? 'false' : 'true');
    }
    if (loaded) {
      if (global.FTTHSim?.scheduleInitialMapCenter) {
        global.FTTHSim.scheduleInitialMapCenter();
      }
      if (!(opts && opts.skipSetupModal)) {
        global.FTTHProjectSetupModal?.open?.();
      }
    } else {
      global.FTTHProjectSetupModal?.close?.();
    }
  }

  function ensureWorkspaceBooted() {
    if (global.FTTHSimBoot?.run) {
      global.FTTHSimBoot.run();
    }
  }

  function loadRecentProject(projectId) {
    if (!projectId) return;
    ensureWorkspaceBooted();
    var ok = global.FTTHFileMenu?.loadProjectByName?.(projectId);
    if (ok === false) return;
    setProjectLoaded(true, { skipSetupModal: true });
  }

  function openRecentProject(name) {
    loadRecentProject(name);
  }

  function beginNewEmptyProjectSetup() {
    global.FTTHProjectSetupModal?.open?.({
      onStart: completeNewEmptyProjectSetup,
    });
  }

  function completeNewEmptyProjectSetup() {
    var sel = document.getElementById('layout-select');
    var cityId = (sel && sel.value) ? sel.value : 'training_city_1';
    ensureWorkspaceBooted();
    if (global.FTTHSim) global.FTTHSim.activeCityId = cityId;
    var ok = global.FTTHFileMenu?.createNewEmptyProject?.();
    if (ok === false) return;
    setProjectLoaded(true, { skipSetupModal: true });
  }

  function returnToStartup() {
    setProjectLoaded(false);
    renderRecentProjects();
  }

  function init() {
    if (!getStartupEl()) return;
    renderRecentProjects();
    renderTemplates();
    setProjectLoaded(false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  global.FTTHStartupView = {
    isProjectLoaded: function () { return isProjectLoaded; },
    setProjectLoaded: setProjectLoaded,
    loadRecentProject: loadRecentProject,
    openRecentProject: openRecentProject,
    beginNewEmptyProjectSetup: beginNewEmptyProjectSetup,
    createNewEmptyProject: beginNewEmptyProjectSetup,
    returnToStartup: returnToStartup,
    refreshRecentProjects: renderRecentProjects,
  };
})(typeof window !== 'undefined' ? window : globalThis);
