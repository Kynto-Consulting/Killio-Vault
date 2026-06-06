const fs = require('fs');
const path = require('path');
const {
  withAndroidManifest,
  withDangerousMod,
  withMainActivity,
} = require('@expo/config-plugins');

/**
 * Vault widgets + shortcuts config plugin.
 *
 *  Copies the native widget resources living under `plugins/widgets/src/main/**`
 *  into the EAS-prebuild Android project (`android/app/src/main/**`) and:
 *    1. Declares three AppWidgetProvider <receiver>s in AndroidManifest.xml
 *       (voice / screenshot+voice / chat).
 *    2. Adds the launcher-shortcuts <meta-data> tag onto MainActivity pointing
 *       at `@xml/shortcuts`.
 *    3. Ensures MainActivity advertises `singleTask` so widget/shortcut taps
 *       bring the existing JS context forward instead of stacking activities.
 *
 *  The JS side reads the `killiovault://assistant?action=<voice|screenshot_voice|chat>`
 *  intent payload via `expo-router`'s `Linking.getInitialURL()` + the `_layout`
 *  `useEffect` that listens to `Linking.addEventListener('url', …)`.
 */

const PACKAGE = 'dev.killio.vault';
const PROVIDER_PREFIX = `${PACKAGE}.widgets`;

const PROVIDERS = [
  { class: 'VaultVoiceWidget', meta: 'widget_voice_info' },
  { class: 'VaultScreenshotWidget', meta: 'widget_screenshot_info' },
  { class: 'VaultChatWidget', meta: 'widget_chat_info' },
];

function copyDirSync(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const sp = path.join(src, entry.name);
    const dp = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(sp, dp);
    } else {
      fs.copyFileSync(sp, dp);
    }
  }
}

function mergeStringsXml(existingPath, addedPath) {
  if (!fs.existsSync(addedPath)) return;
  if (!fs.existsSync(existingPath)) {
    fs.copyFileSync(addedPath, existingPath);
    return;
  }
  const existing = fs.readFileSync(existingPath, 'utf8');
  const added = fs.readFileSync(addedPath, 'utf8');
  // Pull out each <string name="…">…</string> from the new file and append
  // those that aren't already in the existing strings.xml. Keeps merge dumb
  // and resilient — we never rewrite tags the host project owns.
  const tagRe = /<string\s+name="([^"]+)"[^>]*>[\s\S]*?<\/string>/g;
  const existingNames = new Set(
    Array.from(existing.matchAll(tagRe)).map((m) => m[1]),
  );
  const toAppend = [];
  for (const m of added.matchAll(tagRe)) {
    if (!existingNames.has(m[1])) toAppend.push(m[0]);
  }
  if (toAppend.length === 0) return;
  const merged = existing.replace(
    /<\/resources>\s*$/,
    `${toAppend.join('\n    ')}\n</resources>\n`,
  );
  fs.writeFileSync(existingPath, merged);
}

const withCopyNativeFiles = (config) =>
  withDangerousMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot;
      const androidMain = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
      );
      const widgetsRoot = path.join(projectRoot, 'plugins', 'widgets', 'src', 'main');

      // Kotlin sources → app/src/main/java/dev/killio/vault/widgets
      copyDirSync(
        path.join(widgetsRoot, 'java'),
        path.join(androidMain, 'java'),
      );
      // res/xml + res/layout + res/drawable → merged into existing app res dir
      copyDirSync(
        path.join(widgetsRoot, 'res', 'xml'),
        path.join(androidMain, 'res', 'xml'),
      );
      copyDirSync(
        path.join(widgetsRoot, 'res', 'layout'),
        path.join(androidMain, 'res', 'layout'),
      );
      copyDirSync(
        path.join(widgetsRoot, 'res', 'drawable'),
        path.join(androidMain, 'res', 'drawable'),
      );
      // strings.xml must be merged — Expo already writes one with the app name.
      mergeStringsXml(
        path.join(androidMain, 'res', 'values', 'strings.xml'),
        path.join(widgetsRoot, 'res', 'values', 'strings.xml'),
      );

      return cfg;
    },
  ]);

const withWidgetReceivers = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;

    application.receiver = application.receiver || [];
    const existing = new Set(
      application.receiver.map((r) => r.$?.['android:name']),
    );

    for (const p of PROVIDERS) {
      const name = `${PROVIDER_PREFIX}.${p.class}`;
      if (existing.has(name)) continue;
      application.receiver.push({
        $: {
          'android:name': name,
          'android:exported': 'true',
          'android:label': '@string/widget_voice_label',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }],
          },
        ],
        'meta-data': [
          {
            $: {
              'android:name': 'android.appwidget.provider',
              'android:resource': `@xml/${p.meta}`,
            },
          },
        ],
      });
    }

    return cfg;
  });

const withLauncherShortcuts = (config) =>
  withAndroidManifest(config, (cfg) => {
    const application = cfg.modResults.manifest.application?.[0];
    if (!application) return cfg;
    const mainActivity = application.activity?.find(
      (a) => a.$?.['android:name'] === '.MainActivity',
    );
    if (!mainActivity) return cfg;

    // Ensure singleTask so widget taps re-use the existing JS context (avoid
    // stacking multiple MainActivity instances on top of each other).
    mainActivity.$['android:launchMode'] = 'singleTask';

    mainActivity['meta-data'] = mainActivity['meta-data'] || [];
    const has = mainActivity['meta-data'].some(
      (m) => m.$?.['android:name'] === 'android.app.shortcuts',
    );
    if (!has) {
      mainActivity['meta-data'].push({
        $: {
          'android:name': 'android.app.shortcuts',
          'android:resource': '@xml/shortcuts',
        },
      });
    }

    return cfg;
  });

module.exports = function withVaultWidgets(config) {
  config = withCopyNativeFiles(config);
  config = withWidgetReceivers(config);
  config = withLauncherShortcuts(config);
  return config;
};
