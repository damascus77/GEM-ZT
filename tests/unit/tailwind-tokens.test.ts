import { describe, it, expect } from 'vitest';
import config from '@/tailwind.config';

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string>;
const radii = (config.theme?.extend?.borderRadius ?? {}) as Record<string, string>;

describe('tailwind DESIGN.md tokens', () => {
  it('keeps the fixed brand accents as exact DESIGN.md hex values', () => {
    expect(colors.primary).toBe('#1b1938');
    expect(colors['primary-deep']).toBe('#0e0c1f');
    expect(colors['on-primary']).toBe('#ffffff');
    expect(colors['violet-soft']).toBe('#c9b4fa');
    expect(colors['teal-deep']).toBe('#0e3030');
    expect(colors['teal-mid']).toBe('#155555');
    expect(colors['hairline-dark']).toBe('#3f3a52');
    expect(colors['on-dark-mute']).toBe('#bcbac9');
    expect(colors['on-dark-faint']).toBe('#5a5772');
  });

  it('drives neutral surface/text tokens via CSS variables (for light/dark theming)', () => {
    expect(colors.canvas).toBe('rgb(var(--c-canvas) / <alpha-value>)');
    expect(colors['canvas-soft']).toBe('rgb(var(--c-canvas-soft) / <alpha-value>)');
    expect(colors.ink).toBe('rgb(var(--c-ink) / <alpha-value>)');
    expect(colors['ink-mute']).toBe('rgb(var(--c-ink-mute) / <alpha-value>)');
    expect(colors['ink-faint']).toBe('rgb(var(--c-ink-faint) / <alpha-value>)');
    expect(colors.hairline).toBe('rgb(var(--c-hairline) / <alpha-value>)');
  });

  it('enables class-based dark mode', () => {
    expect((config as { darkMode?: string }).darkMode).toBe('class');
  });

  it('maps the DESIGN.md radius scale', () => {
    expect(radii.xs).toBe('4px');
    expect(radii.sm).toBe('6px');
    expect(radii.md).toBe('8px');
    expect(radii.lg).toBe('12px');
    expect(radii.xl).toBe('16px');
  });
});
