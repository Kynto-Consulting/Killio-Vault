import { DEFAULT_LOCALE, MESSAGES, type Locale } from '@/i18n/locales';

/**
 * Native tag support, ported 1:1 from Killio-Frontend's `src/lib/native-tags.ts`.
 *
 * Native tags are stored on the backend with their *key* as the name (e.g.
 * `tag.native.bug`). The UI must translate that key into a human label via the
 * `tags` i18n namespace (keys `native.bug`, `native.priority`, …). Without this
 * the card chips render the raw key string `tag.native.*`.
 */

export const NATIVE_PRIORITY_TAG_KEY = 'tag.native.priority';
export const NATIVE_BUG_TAG_KEY = 'tag.native.bug';
export const NATIVE_FEATURE_TAG_KEY = 'tag.native.feature';
export const NATIVE_UX_TAG_KEY = 'tag.native.ux';
export const NATIVE_BLOCKED_TAG_KEY = 'tag.native.blocked';

export type NativeTagSuggestion = {
  key: string;
  color: string;
};

export const DEFAULT_NATIVE_TAG_SUGGESTIONS: NativeTagSuggestion[] = [
  { key: NATIVE_PRIORITY_TAG_KEY, color: '#e11d48' },
  { key: NATIVE_BUG_TAG_KEY, color: '#ef4444' },
  { key: NATIVE_FEATURE_TAG_KEY, color: '#22c55e' },
  { key: NATIVE_UX_TAG_KEY, color: '#3b82f6' },
  { key: NATIVE_BLOCKED_TAG_KEY, color: '#f59e0b' },
];

const NATIVE_TAG_I18N_KEY_BY_TAG: Record<string, string> = {
  [NATIVE_PRIORITY_TAG_KEY]: 'native.priority',
  [NATIVE_BUG_TAG_KEY]: 'native.bug',
  [NATIVE_FEATURE_TAG_KEY]: 'native.feature',
  [NATIVE_UX_TAG_KEY]: 'native.ux',
  [NATIVE_BLOCKED_TAG_KEY]: 'native.blocked',
};

export function isNativeTagKey(value?: string | null): boolean {
  if (!value) return false;
  return value.startsWith('tag.native.');
}

/**
 * Resolve a tag name to its display label. Native keys (`tag.native.*`) are
 * looked up in the `tags` i18n namespace for the given locale; non-native names
 * pass through unchanged. Mirrors the web `translateNativeTagName`, but reads
 * MESSAGES directly since Vault has no `getI18nText` export.
 */
export function translateNativeTagName(tagName: string, locale: Locale): string {
  if (!isNativeTagKey(tagName)) return tagName;

  const translationKey = NATIVE_TAG_I18N_KEY_BY_TAG[tagName];
  if (!translationKey) return tagName;

  const ns = MESSAGES[locale]?.tags ?? MESSAGES[DEFAULT_LOCALE]?.tags ?? {};
  const translated = ns[translationKey] ?? MESSAGES[DEFAULT_LOCALE]?.tags?.[translationKey];

  return translated || tagName;
}
