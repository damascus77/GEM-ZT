// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Pill } from '@/components/ui/Pill';

describe('UI primitives', () => {
  it('Button primary is an 8px rounded rectangle on indigo', () => {
    render(<Button>Create network</Button>);
    const btn = screen.getByRole('button', { name: 'Create network' });
    expect(btn.className).toContain('bg-primary');
    expect(btn.className).toContain('rounded-md');
    expect(btn.className).not.toContain('rounded-full');
  });

  it('Button outline uses canvas bg and hairline-dark border', () => {
    render(<Button variant="outline">Cancel</Button>);
    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn.className).toContain('border-hairline-dark');
    expect(btn.className).toContain('bg-canvas');
  });

  it('Button pill uses violet-soft pill shape (hero only)', () => {
    render(<Button variant="pill">Get started</Button>);
    const btn = screen.getByRole('button', { name: 'Get started' });
    expect(btn.className).toContain('bg-violet-soft');
    expect(btn.className).toContain('rounded-full');
  });

  it('Card uses canvas bg, hairline border, 12px radius', () => {
    render(<Card data-testid="card">hello</Card>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-canvas');
    expect(card.className).toContain('border-hairline');
    expect(card.className).toContain('rounded-lg');
  });

  it('Input uses 6px radius and hairline border', () => {
    render(<Input aria-label="Name" />);
    const input = screen.getByLabelText('Name');
    expect(input.className).toContain('rounded-sm');
    expect(input.className).toContain('border-hairline');
  });

  it('Pill is a rounded-full chip', () => {
    render(<Pill>Private</Pill>);
    expect(screen.getByText('Private').className).toContain('rounded-full');
  });
});
