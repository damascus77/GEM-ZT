import type { MetadataRoute } from 'next';

// Web app manifest — served at /manifest.webmanifest and auto-linked by Next.
// Makes GEM-ZT installable as a standalone PWA. No service worker: installability
// does not require one, and the app runs behind a nonce-based CSP where a SW would
// need extra allowances (tracked as a separate follow-up).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'GEM-ZT',
    short_name: 'GEM-ZT',
    description: 'Self-hosted ZeroTier network controller',
    start_url: '/',
    display: 'standalone',
    background_color: '#100e1c', // dark page background (--c-canvas-soft, .dark)
    theme_color: '#1b1938', // brand primary
    icons: [
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
      {
        src: '/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'maskable',
      },
    ],
  };
}
