import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Force Node.js runtime so transitive imports of Node built-ins (fs, net) work
// in server components downstream of this middleware.
// Required because:
// - lib/util/ssrf.ts imports node:net
// - lib/controller/token.ts imports node:fs/promises
// Edge runtime does not support these Node.js built-in modules.
export const runtime = 'nodejs';

/**
 * Generates a cryptographically secure nonce for CSP.
 * Uses Web Crypto API (available in Edge runtime).
 */
function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Builds the Content-Security-Policy header value with the given nonce.
 * Policy allows:
 * - Scripts from 'self' plus the generated nonce (for inline scripts like theme init)
 * - Styles from 'self' and 'unsafe-inline' (Tailwind needs unsafe-inline for dynamic styles)
 * - Images from 'self', data:, blob:
 * - Fonts from 'self', data:
 * - Connect to 'self' (API calls)
 * - No frames, no base-uri overrides, form-action restricted to self
 * - upgrade-insecure-requests in production (auto-upgrade HTTP->HTTPS)
 */
function buildCspHeader(nonce: string): string {
  const isProd = process.env.NODE_ENV === 'production';
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(isProd ? ['upgrade-insecure-requests'] : []),
  ];
  return directives.join('; ');
}

export function middleware(request: NextRequest) {
  // Generate a fresh nonce for this request
  const nonce = generateNonce();

  // Create response with modified request headers (pass nonce to layout.tsx)
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-csp-nonce', nonce);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Set CSP header on the SAME response
  response.headers.set('Content-Security-Policy', buildCspHeader(nonce));

  return response;
}

// Match all routes except static assets and API routes that don't serve HTML
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, robots.txt, etc.
     */
    '/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
};
