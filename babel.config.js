module.exports = function (api) {
  api.cache(true);
  return {
    // nativewind v4: jsxImportSource only — do NOT add 'nativewind/babel'.
    // Its css-interop babel preset hardcodes react-native-worklets/plugin
    // (reanimated-4 only), which breaks the SDK 52 / reanimated 3.16 build.
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }]],
  };
};
