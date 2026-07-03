// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from '@/components/ThemeToggle';

afterEach(() => {
  document.documentElement.classList.remove('dark');
  localStorage.clear();
});

describe('ThemeToggle', () => {
  it('toggles the .dark class on <html> and persists the choice', async () => {
    render(<ThemeToggle />);
    // jsdom's <html> has no 'dark' class here, so the button offers to enable it.
    const toDark = await screen.findByRole('button', { name: /switch to dark mode/i });
    await userEvent.click(toDark);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    const toLight = screen.getByRole('button', { name: /switch to light mode/i });
    await userEvent.click(toLight);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
  });
});
