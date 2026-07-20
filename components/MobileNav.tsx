'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import { Logo } from '@/components/Logo';
import { SidebarContent } from '@/components/Sidebar';

/**
 * Mobile navigation: a top bar with a hamburger toggle plus a slide-in drawer
 * that reuses the full sidebar body. Visible only below the `md` breakpoint;
 * the persistent `Sidebar` rail takes over at md and up.
 *
 * The drawer closes on route change, Escape, and overlay tap.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close the drawer whenever the route changes.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 border-b border-hairline bg-primary px-3 py-2 text-on-primary">
        <button
          type="button"
          aria-label="Open navigation menu"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-on-primary hover:bg-primary-deep"
        >
          <HamburgerIcon />
        </button>
        <div className="wght-600 flex items-center gap-[9px] text-[19px] tracking-[-0.3px] text-white">
          <Logo />
          GEM-ZT
        </div>
      </div>

      {/* Overlay */}
      <div
        onClick={() => setOpen(false)}
        aria-hidden={!open}
        className={clsx(
          'fixed inset-0 z-40 bg-black/50 transition-opacity',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
      />

      {/* Drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!open}
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-[272px] max-w-[85vw] flex-col bg-primary text-on-primary shadow-float transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex justify-end px-3 py-2">
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={() => setOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-md text-on-primary hover:bg-primary-deep"
          >
            <CloseIcon />
          </button>
        </div>
        <SidebarContent />
      </aside>
    </div>
  );
}

function HamburgerIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 6h18M3 12h18M3 18h18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
