import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import * as SecureStore from 'expo-secure-store';

import {
  DEFAULT_LOCALE,
  MESSAGES,
  SUPPORTED_LOCALES,
  type Locale,
} from './locales';

/**
 * Minimal i18n matching the Killio-Frontend pattern: an I18nProvider plus
 * useTranslations(namespace) returning a t(key, params) function with
 * {{param}} interpolation. Locale persists in secure storage.
 */
const LOCALE_KEY = 'killio.locale';

interface I18nState {
  locale: Locale;
  setLocale(l: Locale): void;
}

const I18nContext = createContext<I18nState>({
  locale: DEFAULT_LOCALE,
  setLocale: () => {},
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    void SecureStore.getItemAsync(LOCALE_KEY).then((v) => {
      if (v && (SUPPORTED_LOCALES as string[]).includes(v)) {
        setLocaleState(v as Locale);
      }
    });
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    void SecureStore.setItemAsync(LOCALE_KEY, l);
  }, []);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  return useContext(I18nContext);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) =>
    k in params ? String(params[k]) : `{{${k}}}`,
  );
}

export type Translate = (key: string, params?: Record<string, string | number>) => string;

/** Returns a translator scoped to a namespace, e.g. const t = useTranslations('agents'). */
export function useTranslations(namespace: string): Translate {
  const { locale } = useI18n();
  return useCallback(
    (key: string, params?: Record<string, string | number>) => {
      const ns = MESSAGES[locale]?.[namespace] ?? MESSAGES[DEFAULT_LOCALE]?.[namespace] ?? {};
      const raw = ns[key] ?? MESSAGES[DEFAULT_LOCALE]?.[namespace]?.[key] ?? key;
      return interpolate(raw, params);
    },
    [locale, namespace],
  );
}
