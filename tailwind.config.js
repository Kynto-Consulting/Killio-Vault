/** @type {import('tailwindcss').Config} */
// Mirrors Killio-Frontend dark theme tokens (globals.css :root.dark) so Vault
// looks like the web app. Colors are concrete hex (RN has no CSS vars).
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#000000',
        foreground: '#ededed',
        card: '#0a0a0a',
        'card-foreground': '#ededed',
        secondary: '#191919',
        muted: '#262626',
        'muted-foreground': '#a1a1a1',
        border: '#262626',
        input: '#191919',
        primary: '#f5f5f5',
        'primary-foreground': '#171717',
        destructive: '#dc2626',
        accent: '#262626',
        // brand
        lime: '#d8ff72',
        cyan: '#22d3ee',
        indigo: '#6366f1',
        success: '#22c55e',
        warning: '#f59e0b',
      },
      fontFamily: {
        sans: ['Inter_400Regular'],
        mono: ['JetBrainsMono_400Regular'],
      },
      borderRadius: {
        DEFAULT: '8px',
        md: '6px',
        lg: '8px',
        xl: '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
};
