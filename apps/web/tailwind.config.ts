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
        // System fonts only: no download, fast on a phone at the course.
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        display: ['ui-rounded', 'SF Pro Rounded', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
