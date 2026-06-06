const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Injects a release signingConfig into android/app/build.gradle that reads the
 * KILLIO_UPLOAD_* gradle properties (set in GRADLE_USER_HOME/gradle.properties,
 * which is D:\android-build\.gradle on this machine). This is the SAME
 * EAS-managed keystore whose SHA-256 is published in the frontend
 * /.well-known/assetlinks.json — so locally-built release APKs keep the App
 * Links + Play upload identity intact.
 *
 * Survives `expo prebuild --clean` because it re-applies on every prebuild.
 * If the props are absent (e.g. CI without the keystore), release falls back
 * to the debug signingConfig so the build still completes.
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;

    // 1. Add a release signingConfig inside signingConfigs { ... }, right
    //    after the existing debug config. Only inject once.
    if (!gradle.includes('KILLIO_UPLOAD_STORE_FILE')) {
      const releaseSigning = `
        release {
            if (project.hasProperty('KILLIO_UPLOAD_STORE_FILE')) {
                storeFile file(KILLIO_UPLOAD_STORE_FILE)
                storePassword KILLIO_UPLOAD_STORE_PASSWORD
                keyAlias KILLIO_UPLOAD_KEY_ALIAS
                keyPassword KILLIO_UPLOAD_KEY_PASSWORD
            }
        }`;
      // Insert just before the closing brace of `signingConfigs {`.
      gradle = gradle.replace(
        /signingConfigs\s*\{/,
        (m) => `${m}${releaseSigning}\n`,
      );
    }

    // 2. Point the release buildType at the release signingConfig when the
    //    keystore props exist, else keep debug signing.
    gradle = gradle.replace(
      /buildTypes\s*\{[\s\S]*?release\s*\{([\s\S]*?)signingConfig\s+signingConfigs\.debug/,
      (full) =>
        full.replace(
          'signingConfig signingConfigs.debug',
          "signingConfig project.hasProperty('KILLIO_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug",
        ),
    );

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
