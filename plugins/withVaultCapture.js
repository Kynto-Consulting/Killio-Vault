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
  // Non-recording keep-alive FGS (dataSync type) that holds the JS runtime alive
  // in the background so the local cron scheduler keeps ticking when capture is
  // off. Android 14+ requires the type-specific permission.
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  // Phase 4: screen capture via MediaProjection.
  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  // REQUIRED for screen-off / Doze: a PARTIAL_WAKE_LOCK keeps the CPU running
  // so AudioRecord / SpeechRecognizer keep producing frames while the display
  // is off. Without this the capture services are suspended within seconds of
  // the screen turning off and 24/7 capture silently dies.
  'android.permission.WAKE_LOCK',
  // open_app needs to resolve other apps' launch intents.
  'android.permission.QUERY_ALL_PACKAGES',
  // Device convenience integrations.
  'android.permission.READ_CONTACTS',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.SEND_SMS',
  // Torch control (flashlight client-action) goes through expo-camera.
  'android.permission.CAMERA',
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
