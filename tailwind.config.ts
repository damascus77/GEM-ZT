import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Fixed brand accents (same in light + dark).
        primary: '#1b1938',
        'primary-deep': '#0e0c1f',
        'on-primary': '#ffffff',
        'violet-soft': '#c9b4fa',
        'teal-deep': '#0e3030',
        'teal-mid': '#155555',
        'hairline-dark': '#3f3a52',
        'on-dark-mute': '#bcbac9',
        'on-dark-faint': '#5a5772',
        // Neutral surface/text tokens — driven by CSS variables so the whole app
        // flips between light and dark via a `.dark` class on <html>.
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        'canvas-soft': 'rgb(var(--c-canvas-soft) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-mute': 'rgb(var(--c-ink-mute) / <alpha-value>)',
        'ink-faint': 'rgb(var(--c-ink-faint) / <alpha-value>)',
        hairline: 'rgb(var(--c-hairline) / <alpha-value>)',
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      boxShadow: {
        lift: '0 1px 3px rgba(0,0,0,0.08)',
        float: '0 8px 24px rgba(0,0,0,0.12)',
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
