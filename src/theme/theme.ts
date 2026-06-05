/**
 * Killio design tokens, ported from Killio-Frontend (tailwind.config.ts +
 * globals.css dark mode, which is Killio's default theme). Keeping these in sync
 * avoids re-deriving brand colors and keeps Vault visually identical to the web app.
 *
 * Source (dark mode HSL → hex):
 *   --background 0 0% 0%      #000000
 *   --foreground 0 0% 93%     #ededed
 *   --card       0 0% 4%      #0a0a0a
 *   --secondary  0 0% 10%     #191919
 *   --muted      0 0% 15%     #262626
 *   --muted-fg   0 0% 63%     #a1a1a1
 *   --border     0 0% 15%     #262626
 *   --primary    0 0% 98%     #f5f5f5
 *   --destructive            #dc2626
 * Landing accents: lime #d8ff72, cyan #22d3ee, indigo #6366f1
 */

export const colors = {
  background: '#000000',
  surface: '#0a0a0a', // card
  surfaceAlt: '#191919', // secondary
  foreground: '#ededed',
  muted: '#262626',
  mutedForeground: '#a1a1a1',
  border: '#262626',
  primary: '#f5f5f5',
  primaryForeground: '#171717',
  destructive: '#dc2626',
  // brand accents
  lime: '#d8ff72',
  cyan: '#22d3ee',
  indigo: '#6366f1',
  // status
  success: '#22c55e',
  warning: '#f59e0b',
} as const;

/** Procedural tag palette, matches the frontend tag color list. */
export const tagPalette = [
  '#ef4444',
  '#f59e0b',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
] as const;

export const radius = { sm: 4, md: 6, lg: 8, xl: 12, pill: 999 } as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const typography = {
  fontSize: { xs: 12, sm: 14, base: 16, lg: 18, xl: 20, '2xl': 24, '3xl': 32 },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
} as const;

export const theme = { colors, tagPalette, radius, spacing, typography };
export type Theme = typeof theme;
