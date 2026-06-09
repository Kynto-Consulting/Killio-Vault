// Re-export the native module wrapper. Autolinking only attaches the Kotlin
// module when this package is part of the JS module graph at build time, so the
// wrapper imports it via requireOptionalNativeModule.
export * from '../../src/integrations/native/KillioAppIntent';
