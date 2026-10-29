(function () {
  'use strict';

  var root;

  function host() {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ifa-toast-stack';
    root.setAttribute('aria-live', 'polite');
    document.body.appendChild(root);
    return root;
  }

  function notify(message, type) {
    var text = String(message == null ? '' : message);
    if (!text) return;
    var kind = type || (/خطأ|تعذر|فشل|error/i.test(text) ? 'error' : 'success');
    var item = document.createElement('div');
    item.className = 'ifa-toast ifa-toast--' + kind;
    item.textContent = text;
    host().appendChild(item);
    setTimeout(function () {
      item.classList.add('is-leaving');
      setTimeout(function () {
        if (item.parentNode) item.parentNode.removeChild(item);
      }, 250);
    }, 3200);
  }

  window.ifaNotify = notify;
  window.alert = function (message) {
    notify(message);
  };
})();
