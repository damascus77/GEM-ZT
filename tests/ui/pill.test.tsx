// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pill } from '@/components/ui/Pill';

describe('Pill tone', () => {
  it('default tone uses canvas bg and ink text on a hairline border', () => {
    render(<Pill>Offline</Pill>);
    const pill = screen.getByText('Offline');
    expect(pill.className).toContain('bg-canvas');
    expect(pill.className).toContain('text-ink');
    expect(pill.className).toContain('border-hairline');
    expect(pill.className).toContain('rounded-full');
  });

  it('success tone fills with teal-mid and white text, never the invisible teal-deep', () => {
    render(<Pill tone="success">Online</Pill>);
    const pill = screen.getByText('Online');
    expect(pill.className).toContain('bg-teal-mid');
    expect(pill.className).toContain('text-white');
    expect(pill.className).toContain('border-teal-mid');
    // The old low-contrast foreground must be gone.
    expect(pill.className).not.toContain('text-teal-deep');
  });

  it('success tone does not fall back to the default canvas/ink styling', () => {
    render(<Pill tone="success">Reachable</Pill>);
    const pill = screen.getByText('Reachable');
    expect(pill.className).not.toContain('bg-canvas');
    expect(pill.className).not.toContain('text-ink');
  });
});
