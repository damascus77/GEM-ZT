'use client';

import { useEffect, useState } from 'react';

/**
 * Toggles the `.dark` class on <html> and persists the choice to localStorage.
 * The initial class is set pre-paint by the inline script in the root layout;
 * this component just reflects and flips it.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('theme', next ? 'dark' : 'light');
    } catch {
      // ignore storage failures (private mode etc.)
    }
    setIsDark(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className}
    >
      {isDark ? '☀ Light mode' : '🌙 Dark mode'}
    </button>
  );
}
