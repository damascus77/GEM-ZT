/**
 * GEM-ZT Design Tokens
 * Single source of truth for all design values.
 * Used by globals.css (CSS variables), tailwind.config.ts, and any TypeScript consumers.
 */

// ============================================================================
// Color Tokens
// ============================================================================

/** Brand accent colors — same in light and dark mode */
export const brandColors = {
  primary: '#1b1938',
  'primary-deep': '#0e0c1f',
  'on-primary': '#ffffff',
  'violet-soft': '#c9b4fa',
  'teal-deep': '#0e3030',
  'teal-mid': '#155555',
  'hairline-dark': '#3f3a52',
  'on-dark-mute': '#bcbac9',
  'on-dark-faint': '#5a5772',
  // Foreground for filled danger surfaces (theme-invariant, like on-primary).
  'on-danger': '#ffffff',
} as const;

/** Semantic color tokens for light mode.
 *  Dark mode values are defined in globals.css via .dark class overrides. */
export const semanticColorsLight = {
  canvas: '#ffffff',
  'canvas-soft': '#fafaf8',
  ink: '#292827',
  'ink-mute': '#73706d',
  'ink-faint': '#9a9794',
  hairline: '#e8e4dd',
  // Positive/"added" foreground. Dark teal reads on white; the dark-mode value
  // below swaps to a light teal so it stays legible on the dark page background.
  success: '#0e3030',
  // Destructive/error foreground. Deep red reads on white; the dark-mode value
  // below lightens so it stays legible on the dark page background.
  danger: '#c0392b',
} as const;

/** Semantic color tokens for dark mode (for reference; actual values in CSS) */
export const semanticColorsDark = {
  canvas: '#1c1a2e',
  'canvas-soft': '#100e1c',
  ink: '#e9e7f1',
  'ink-mute': '#a5a2b8',
  'ink-faint': '#78758f',
  hairline: '#302b44',
  // Light teal so positive text stays legible on #100e1c (the dark teal-deep
  // #0e3030 was ~1.1:1 contrast there — effectively invisible).
  success: '#5fd0c4',
  // Lightened red so destructive text stays legible on #100e1c.
  danger: '#ff6b6b',
} as const;

// ============================================================================
// Spacing Tokens
// ============================================================================

export const spacing = {
  xxs: '2px',
  xs: '4px',
  sm: '8px',
  md: '12px',
  lg: '16px',
  xl: '24px',
  xxl: '32px',
  huge: '64px',
} as const;

// ============================================================================
// Border Radius Tokens
// ============================================================================

export const borderRadius = {
  xs: '4px',
  sm: '6px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  full: '9999px',
} as const;

// ============================================================================
// Box Shadow Tokens
// ============================================================================

export const boxShadow = {
  lift: '0 1px 3px rgba(0,0,0,0.08)',
  float: '0 8px 24px rgba(0,0,0,0.12)',
} as const;

// ============================================================================
// Typography Tokens
// ============================================================================

export const fontFamily = {
  sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
};

// ============================================================================
// All Tokens Export (used by tailwind.config.ts)
// ============================================================================

export const tokens = {
  colors: {
    brand: brandColors,
    semantic: {
      light: semanticColorsLight,
      dark: semanticColorsDark,
    },
  },
  spacing,
  borderRadius,
  boxShadow,
  fontFamily,
} as const;
