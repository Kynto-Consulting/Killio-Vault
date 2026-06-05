// Re-export the native module wrapper used by the rest of the app. Autolinking
// only attaches the Kotlin module when this package is part of the JS module
// graph at build time, so the wrapper imports it via requireOptionalNativeModule.
export * from '../../src/capture/native/KillioCapture';
