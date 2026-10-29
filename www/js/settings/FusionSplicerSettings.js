/**
 * Fusion Splicer Lab — independent device metadata / toolbox config.
 * localStorage key: ifa_splicer_config
 * Never reads or writes ifa_ftth_lab_config.
 */
(function (global) {
  'use strict';

  if (typeof global.createLabDeviceConfigStore !== 'function') {
    console.warn('[FusionSplicerSettings] createLabDeviceConfigStore is missing. Load FtthLabSettings.js first.');
    return;
  }

  var factory = global.FACTORY_DEFAULT_FTTH_LAB_CONFIG
    ? JSON.parse(JSON.stringify(global.FACTORY_DEFAULT_FTTH_LAB_CONFIG))
    : { version: 3, categories: [], items: [], sfpVariants: [] };

  global.FusionSplicerSettings = global.createLabDeviceConfigStore({
    storageKey: 'ifa_splicer_config',
    eventPrefix: 'ifa:splicer',
    firestoreApi: 'splicer',
    factoryConfig: factory,
  });
})(typeof window !== 'undefined' ? window : globalThis);
