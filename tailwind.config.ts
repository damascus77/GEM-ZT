import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1b1938',
        'primary-deep': '#0e0c1f',
        'on-primary': '#ffffff',
        ink: '#292827',
        'ink-mute': '#73706d',
        'ink-faint': '#9a9794',
        canvas: '#ffffff',
        'canvas-soft': '#fafaf8',
        'violet-soft': '#c9b4fa',
        'teal-deep': '#0e3030',
        'teal-mid': '#155555',
        hairline: '#e8e4dd',
        'hairline-dark': '#3f3a52',
        'on-dark-mute': '#bcbac9',
        'on-dark-faint': '#5a5772',
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
