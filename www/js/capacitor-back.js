(function () {
  var cap = window.Capacitor;
  var App = cap && cap.Plugins && cap.Plugins.App;
  if (!App || typeof App.addListener !== 'function') return;

  var lastBack = 0;
  var hideTimer = 0;

  function showExitToast() {
    var toast = document.querySelector('.exit-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'exit-toast';
      toast.setAttribute('role', 'status');
      toast.textContent = 'اضغط مرة أخرى للخروج';
      document.body.appendChild(toast);
    }
    toast.classList.add('is-visible');
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      toast.classList.remove('is-visible');
    }, 1800);
  }

  App.addListener('appStateChange', function (state) {
    if (!state || !state.isActive) return;
    document.dispatchEvent(new CustomEvent('ifa:app-resumed'));
  });

  App.addListener('backButton', function (event) {
    var home = document.getElementById('view-home');
    if (home && !home.classList.contains('active') && typeof window.switchTab === 'function') {
      window.switchTab('home');
      return;
    }
    if (event && event.canGoBack) {
      window.history.back();
      return;
    }
    var now = Date.now();
    if (now - lastBack < 2000) {
      App.exitApp();
      return;
    }
    lastBack = now;
    showExitToast();
  });
})();
