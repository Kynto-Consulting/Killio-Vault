const { AndroidConfig, withAndroidManifest } = require('@expo/config-plugins');

/**
 * Config plugin: declares the Android permissions Vault needs for background
 * audio capture (and later phases). The microphone-typed foreground service
 * itself is declared by the local killio-capture module's manifest, which the
 * manifest merger combines into the final APK.
 */
const PERMISSIONS = [
  'android.permission.RECORD_AUDIO',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  // Phase 4: screen capture via MediaProjection.
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // open_app needs to resolve other apps' launch intents.
  'android.permission.QUERY_ALL_PACKAGES',
  // Device convenience integrations.
  'android.permission.READ_CONTACTS',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.SEND_SMS',
];

module.exports = function withVaultCapture(config) {
  return withAndroidManifest(config, (cfg) => {
    // modResults is the parsed { manifest: {...} } document — mutate the inner
    // `manifest` node, NOT modResults itself (doing so adds a second top-level
    // key and xml2js wraps the whole file in <root>, producing an invalid
    // AndroidManifest.xml).
    const manifest = cfg.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    const existing = new Set(
      manifest['uses-permission'].map((p) => p.$['android:name']),
    );
    for (const name of PERMISSIONS) {
      if (!existing.has(name)) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }
    return cfg;
  });
};

// Keep the AndroidConfig import referenced for future helpers (intent filters,
// queries for open_app/open_browser in later phases).
void AndroidConfig;
