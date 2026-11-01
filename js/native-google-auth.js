function capacitorGlobal() {
  return typeof window !== 'undefined' ? window.Capacitor : null;
}

export function isNativeCapacitor() {
  var cap = capacitorGlobal();
  return !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
}

export function getGoogleAuth() {
  var cap = capacitorGlobal();
  if (!cap || typeof cap.registerPlugin !== 'function') return null;
  if (!getGoogleAuth.plugin) {
    getGoogleAuth.plugin = cap.registerPlugin('GoogleAuth');
  }
  return getGoogleAuth.plugin;
}

var GOOGLE_AUTH_SERVER_CLIENT_ID = 'ضع_الـ_ID_الحقيقي_هنا';

export function initializeNativeGoogleAuth() {
  var GoogleAuth = getGoogleAuth();
  if (!GoogleAuth || typeof GoogleAuth.initialize !== 'function') return Promise.resolve();
  return Promise.resolve(
    GoogleAuth.initialize({
      scopes: ['profile', 'email'],
      serverClientId: GOOGLE_AUTH_SERVER_CLIENT_ID,
      grantOfflineAccess: true,
    })
  ).catch(function (err) {
    console.warn('[Auth] GoogleAuth.initialize failed', err);
  });
}

export function signInWithNativeGoogle() {
  var cap = capacitorGlobal();
  if (!cap || typeof cap.registerPlugin !== 'function') {
    var missing = new Error('GoogleAuth plugin is not available');
    missing.code = 'auth/operation-not-supported-in-this-environment';
    return Promise.reject(missing);
  }
  return initializeNativeGoogleAuth().then(function () {
    var GoogleAuth = getGoogleAuth();
    if (!GoogleAuth || typeof GoogleAuth.signIn !== 'function') {
      var err = new Error('GoogleAuth plugin is not available');
      err.code = 'auth/operation-not-supported-in-this-environment';
      throw err;
    }
    return GoogleAuth.signIn();
  });
}
