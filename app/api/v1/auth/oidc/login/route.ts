import { NextResponse } from 'next/server';
import { apiError, handleRouteError } from '@/lib/api/errors';
import { buildAuthUrl, isOidcEnabled } from '@/lib/services/oidc';
import {
  OIDC_STATE_COOKIE,
  encodeOidcState,
  oidcStateCookieOptions,
} from '@/lib/services/oidcState';

/**
 * GET: begin the OIDC login. Builds the authorization URL (with PKCE + state +
 * nonce), stashes those transient values in a short-lived httpOnly cookie, and
 * 302-redirects the browser to the IdP.
 */
export async function GET() {
  try {
    if (!isOidcEnabled()) {
      return apiError('NOT_FOUND', 'SSO is not enabled on this instance.', 404);
    }
    const { url, state, nonce, codeVerifier } = await buildAuthUrl();
    const res = NextResponse.redirect(url, 302);
    res.cookies.set(
      OIDC_STATE_COOKIE,
      encodeOidcState({ state, nonce, codeVerifier }),
      oidcStateCookieOptions()
    );
    return res;
  } catch (e) {
    return handleRouteError(e);
  }
}
