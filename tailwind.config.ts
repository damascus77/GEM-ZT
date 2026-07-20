import type { Config } from 'tailwindcss';
import { tokens } from './lib/design/tokens';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Fixed brand accents (same in light + dark) — from design tokens
        primary: tokens.colors.brand.primary,
        'primary-deep': tokens.colors.brand['primary-deep'],
        'on-primary': tokens.colors.brand['on-primary'],
        'violet-soft': tokens.colors.brand['violet-soft'],
        'teal-deep': tokens.colors.brand['teal-deep'],
        'teal-mid': tokens.colors.brand['teal-mid'],
        'hairline-dark': tokens.colors.brand['hairline-dark'],
        'on-dark-mute': tokens.colors.brand['on-dark-mute'],
        'on-dark-faint': tokens.colors.brand['on-dark-faint'],
        'on-danger': tokens.colors.brand['on-danger'],
        // Neutral surface/text tokens — driven by CSS variables so the whole app
        // flips between light and dark via a `.dark` class on <html>.
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        'canvas-soft': 'rgb(var(--c-canvas-soft) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-mute': 'rgb(var(--c-ink-mute) / <alpha-value>)',
        'ink-faint': 'rgb(var(--c-ink-faint) / <alpha-value>)',
        hairline: 'rgb(var(--c-hairline) / <alpha-value>)',
        success: 'rgb(var(--c-success) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
      },
      borderRadius: {
        xs: tokens.borderRadius.xs,
        sm: tokens.borderRadius.sm,
        md: tokens.borderRadius.md,
        lg: tokens.borderRadius.lg,
        xl: tokens.borderRadius.xl,
      },
      boxShadow: {
        lift: tokens.boxShadow.lift,
        float: tokens.boxShadow.float,
      },
      fontFamily: {
        sans: tokens.fontFamily.sans,
      },
    },
  },
  plugins: [],
};

export default config;
