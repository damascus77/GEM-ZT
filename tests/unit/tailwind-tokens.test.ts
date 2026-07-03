import { describe, it, expect } from 'vitest';
import config from '@/tailwind.config';

const colors = (config.theme?.extend?.colors ?? {}) as Record<string, string>;
const radii = (config.theme?.extend?.borderRadius ?? {}) as Record<string, string>;

describe('tailwind DESIGN.md tokens', () => {
  it('maps the DESIGN.md palette exactly', () => {
    expect(colors.primary).toBe('#1b1938');
    expect(colors['primary-deep']).toBe('#0e0c1f');
    expect(colors['on-primary']).toBe('#ffffff');
    expect(colors.ink).toBe('#292827');
    expect(colors['ink-mute']).toBe('#73706d');
    expect(colors['ink-faint']).toBe('#9a9794');
    expect(colors.canvas).toBe('#ffffff');
    expect(colors['canvas-soft']).toBe('#fafaf8');
    expect(colors['violet-soft']).toBe('#c9b4fa');
    expect(colors['teal-deep']).toBe('#0e3030');
    expect(colors['teal-mid']).toBe('#155555');
    expect(colors.hairline).toBe('#e8e4dd');
    expect(colors['hairline-dark']).toBe('#3f3a52');
    expect(colors['on-dark-mute']).toBe('#bcbac9');
    expect(colors['on-dark-faint']).toBe('#5a5772');
  });

  it('maps the DESIGN.md radius scale', () => {
    expect(radii.xs).toBe('4px');
    expect(radii.sm).toBe('6px');
    expect(radii.md).toBe('8px');
    expect(radii.lg).toBe('12px');
    expect(radii.xl).toBe('16px');
  });
});
