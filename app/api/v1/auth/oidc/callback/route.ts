import { NextResponse } from 'next/server';
import { createSessionWithOrg, SESSION_COOKIE, sessionCookieOptions } from '@/lib/services/auth';
import { handleCallback, resolveOidcUser, isOidcEnabled } from '@/lib/services/oidc';
import {
  OIDC_STATE_COOKIE,
  clearOidcStateCookieHeader,
  decodeOidcState,
} from '@/lib/services/oidcState';
import { logAudit } from '@/lib/services/audit';

// Where to send the browser after login (and on failure). Kept relative so it
// can't be turned into an open redirect.
const SUCCESS_PATH = '/networks';
const FAILURE_PATH = '/login?error=sso';

function redirectTo(req: Request, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, new URL(req.url).origin), 302);
}

/**
 * GET: the IdP's redirect back to us. Validates the state cookie, exchanges the
 * code (verifying state/nonce/PKCE), provisions/links the user, and issues the
 * normal gemzt_session cookie — reusing the existing session machinery so the
 * rest of the app is unaware the login came from SSO.
 */
export async function GET(req: Request) {
  if (!isOidcEnabled()) {
    return redirectTo(req, FAILURE_PATH);
  }

  const cookieHeader = req.headers.get('cookie') ?? '';
  const rawState = cookieHeader
    .split(';')
    .map(c => c.trim())
    .find(c => c.startsWith(`${OIDC_STATE_COOKIE}=`))
    ?.slice(OIDC_STATE_COOKIE.length + 1);
  const login = decodeOidcState(rawState ? decodeURIComponent(rawState) : undefined);

  if (!login) {
    // No/*invalid* state cookie: can't safely complete the exchange.
    const res = redirectTo(req, FAILURE_PATH);
    res.headers.append('Set-Cookie', clearOidcStateCookieHeader());
    return res;
  }

  try {
    const identity = await handleCallback(new URL(req.url), {
      codeVerifier: login.codeVerifier,
      expectedState: login.state,
      expectedNonce: login.nonce,
    });
    const user = await resolveOidcUser(identity);
    const session = await createSessionWithOrg(user.id);

    await logAudit({
      userId: user.id,
      action: 'user.login.oidc',
      targetType: 'user',
      targetId: user.id,
    });

    const res = redirectTo(req, SUCCESS_PATH);
    res.cookies.set(SESSION_COOKIE, session.id, sessionCookieOptions());
    res.headers.append('Set-Cookie', clearOidcStateCookieHeader());
    return res;
  } catch (e) {
    console.error('[gem-zt] OIDC callback failed:', e);
    const res = redirectTo(req, FAILURE_PATH);
    res.headers.append('Set-Cookie', clearOidcStateCookieHeader());
    return res;
  }
}
