import type { Config } from 'tailwindcss';

// Tour brand (docs/ROADMAP.md, Brand). Navy main, red accent, gold highlights, silver trim.
// Values taken from public/brand/flag-icon.png.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 950: '#0a1838', 900: '#0b2154', 800: '#14295a', 700: '#1f3a75', 600: '#2c4c8f' },
        brandred: { 700: '#9a1124', 600: '#b5152b', 500: '#d02a40' },
        gold: { 500: '#c9a227', 400: '#dbb847', 300: '#e8cd72' },
        silver: { 300: '#cbcfd7', 400: '#9ea6bb' },
      },
      fontFamily: {
        // Fonts are bundled with the app (no call to Google at runtime), matching the season poster:
        // Inter for text, Anton for headlines, Oswald for spaced-out labels and buttons.
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'],
        display: ['Anton', 'Impact', '"Arial Narrow"', 'sans-serif'],
        label: ['Oswald', '"Arial Narrow"', 'ui-sans-serif', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
