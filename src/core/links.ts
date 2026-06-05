import { Linking } from 'react-native';

/** Public Killio web URLs (front = killio.dev) for in-app hyperlinks. */
export const FRONT_URL = 'https://killio.dev';

export const LINKS = {
  home: FRONT_URL,
  terms: `${FRONT_URL}/terms`,
  privacy: `${FRONT_URL}/privacy`,
  cookies: `${FRONT_URL}/cookies`,
  forgotPassword: `${FRONT_URL}/forgot-password`,
  pricing: `${FRONT_URL}/pricing`,
  help: `${FRONT_URL}/help`,
} as const;

export function openLink(url: string): void {
  void Linking.openURL(url).catch(() => undefined);
}
