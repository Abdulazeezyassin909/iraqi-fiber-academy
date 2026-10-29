/**
 * Course details page — light deterrent only (not true security).
 * Disables context menu and common DevTools / view-source shortcuts.
 */
(function () {
  'use strict';

  document.addEventListener(
    'contextmenu',
    function (event) {
      event.preventDefault();
    },
    true
  );

  function isBlockedDevToolsKey(event) {
    var key = event.key || '';
    var keyCode = event.keyCode || event.which;

    if (keyCode === 123 || key === 'F12') {
      return true;
    }

    var letter = key.length === 1 ? key.toUpperCase() : '';
    var isI = letter === 'I' || keyCode === 73;
    var isJ = letter === 'J' || keyCode === 74;
    var isC = letter === 'C' || keyCode === 67;
    var isU = letter === 'U' || keyCode === 85;

    if (event.shiftKey && (event.ctrlKey || event.metaKey) && (isI || isJ || isC)) {
      return true;
    }

    if (event.metaKey && event.altKey && (isI || isJ || isC || isU)) {
      return true;
    }

    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && isU) {
      return true;
    }

    return false;
  }

  document.addEventListener(
    'keydown',
    function (event) {
      if (!isBlockedDevToolsKey(event)) return;
      event.preventDefault();
      event.stopPropagation();
      return false;
    },
    true
  );
})();
